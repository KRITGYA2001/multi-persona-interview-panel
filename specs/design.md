# Design — Panel: Coordinated AI Interview Panel

Companion to [requirements.md](./requirements.md). Requirement IDs (R1, R2, ...) are referenced throughout so implementation traces back to a spec item.

---

## 1. Architecture Overview

**Next.js frontend + Postgres-backed API routes.** A single Next.js project deployable on Vercel or Netlify, backed by a serverless Postgres database (Neon). Next.js `app/api` routes are still the only way the browser talks to Agora/Anthropic/the database, but they are no longer purely stateless proxies: routes that touch session config, shared candidate context, or reports read/write **Postgres** as the system of record. The browser keeps its own React state for live UI responsiveness during a session (so the transcript/competency panel updates instantly without round-tripping every render), but that state is a cache of what's in the database, not the source of truth — the database is.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Web) — stateful UI cache           │
│   Setup screen   │   Live Interview screen   │   Report screen       │
│  (recruiter)      │  (candidate + live view)  │  (recruiter)         │
│                                                                       │
│  Client-side orchestrator (runs in the browser):                    │
│   - Persona controller (turn-taking / handoff decisions)            │
│   - Shared Candidate Context (§3) — React state, synced to backend  │
│   - Contradiction / vagueness tagging (drives calls below)          │
│   - Report viewer + client-side export (PDF/markdown)               │
└─────────┬───────────────────┬───────────────────────┬───────────────┘
          │ fetch (reads/writes DB) │ Agora RTC + RTM   │ fetch (reads/writes DB)
          ▼                    ▼                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Next.js API routes — Postgres-backed                │
│  /api/generate-agora-token   /api/invite-agent   /api/stop-conversation │
│  /api/session (create/get)   /api/extract-claims   /api/compose-turn │
│  /api/generate-report                                                │
│  Session/context/report routes read-modify-write Postgres; token/    │
│  invite/stop routes stay thin proxies to Agora (no DB needed there). │
└─────────┬───────────────────────────────────────┬───────────────────┘
          │                                        │
          ▼                                        ▼
┌───────────────────────────┐          ┌───────────────────────────┐          ┌─────────────────┐
│ Agora Conversational AI    │          │        LLM Provider        │          │  Postgres (Neon)  │
│ Engine (3 agent instances, │◄────────►│  (per-persona system       │          │  sessions,         │
│ one per persona, same      │          │   prompts + tool calls)    │          │  candidate_context,│
│ RTC channel)                │          └───────────────────────────┘          │  reports, events   │
│  - STT / TTS per persona    │                                                 └─────────────────┘
│  - Turn-taking / interrupt  │
│  - Tool orchestration       │
└───────────────────────────┘
```

**Why this shape:** Agora's Conversational AI Engine already owns the hard real-time voice problems (transport, barge-in, STT/TTS, tool-call plumbing) per R3. We don't rebuild that — we add an orchestration layer *above* it that makes three agent instances behave like one coordinated panel, which is where the actual differentiation (R2, R4, R5) lives. Backing that layer with **Postgres** (instead of `localStorage` alone) buys durability that survives a lost tab, a different device, or a browser crash — the session link works from anywhere, reconnection reads real server state instead of hoping the same browser still has it, and reports are queryable/listable after the fact rather than living only in one recruiter's browser. Neon's serverless model (scale-to-zero, instant branching) keeps this from costing meaningful setup/ops time even on a one-week sprint. See §9 for what this means for reconnection.

**Auth, concretely:** per [requirements.md](./requirements.md#1-about-the-project)'s non-goals, there's no full user-account system. If a lightweight access gate is wanted on the Setup screen (e.g. a shared team passcode), it's checked against a value baked in at build time and the "logged in" flag is written to `localStorage` — there is still no user table, password, or session cookie; this is separate from the session/context/report persistence, which does live in Postgres.

> **Open technical question — de-risked, still needs a live confirm.** Whether 3 agent instances can join one RTC channel simultaneously, or whether we need a different pattern (single agent, hot-swapped persona state), used to be a cold unknown. It no longer is: the official reference implementation (`agora-agents` SDK, used by [github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs](https://github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs) — see §1a below) starts an agent session via `agent.createSession({ channel, agentUid, remoteUids, ... })`, where **`agentUid` and `remoteUids` are per-session, not per-channel** — there's no field or constraint in the SDK's types suggesting one agent per channel. That's the exact shape a 3-persona panel needs: three sessions, one `channel_name`, three distinct `agentUid`s, each with `remoteUids: [candidateUid]`. This is inferred from the SDK's public contract, not confirmed against Agora's live service (undocumented concurrency/billing limits could still exist) — so it's now a **quick confirm**, not an open design fork: try starting a 2nd session in the same channel early (Day 0/1), and only fall back to hot-swap-persona if it's rejected. Bring it to the Round 3 1:1 mentor session (see [requirements.md §5](./requirements.md#5-round-3--development-sprint-program-context)) if it doesn't work on the first attempt, and post to Agora Discord in the meantime rather than waiting on the single scheduled slot. Both patterns are compatible with the rest of this design — the shared-context/orchestrator/report layers are unaffected either way.

> **Second open technical question — turn arbitration, also de-risked but unconfirmed.** Joining one channel is necessary but not sufficient: the quickstart's default pattern is a fully autonomous STT→LLM→TTS loop per session, so naively running 3 sessions risks all 3 independently generating a response to every candidate utterance. Reading the `agora-agents` type surface directly (not just docs) shows the primitives needed to prevent that: `session.say(text)` speaks exact orchestrator-composed text on demand; `session.think(text, { on_listening_action })` injects context into a session *without* it speaking — this is the mechanism for "keep it listening, update shared context" (§4 step 1); `session.update(config)` updates an agent's instructions at runtime without recreating the session; and `turnDetection.config.start_of_speech.mode: "disabled"` (with `disabled_config.strategy: "append" | "ignored"`) looks like the switch to stop an inactive persona's session from auto-firing a reply. **Still needs a Day 0/1 hands-on confirm** of the exact combination — specifically whether `start_of_speech: "disabled"` also suppresses that session's STT processing (cost/duplication) or only its auto-response (see the STT-cost note in §4 below). Same escalation path as the channel-join question if it doesn't behave as the types suggest.

### 1a. Reference implementation — don't build the voice plumbing from scratch

Start from the official Next.js quickstart rather than hand-rolling Agora token generation, RTC join, and agent invite/stop routes — it already implements the boring-but-easy-to-get-wrong parts of R1/R3:

- **Repo:** [github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs](https://github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs) — `agora init my-panel --template nextjs` (needs the Agora CLI + `agora login` + an Agora Console project) or a plain `git clone` if you'd rather wire credentials by hand via `agora project env write .env.local`.
- **Server SDK:** `agora-agents` (npm). One `Agent` instance is configured with `.withStt(...)`, `.withLlm(...)`, `.withTts(...)`, then `agent.createSession({ channel, agentUid, remoteUids, idleTimeout, expiresIn })` starts it. This is the call our orchestrator makes 3× (once per persona) per interview.
- **LLM vendor:** `agora-agents` ships a first-class `Anthropic` class (`new Anthropic({ apiKey, model, url: 'https://api.anthropic.com/v1/messages', headers: { 'anthropic-version': '2023-06-01' } })`) — Claude is natively supported via BYOK (`ANTHROPIC_API_KEY`), not an OpenAI-compatible shim. The quickstart's default (no keys required) uses Agora-managed OpenAI `gpt-4o-mini`; swap to `Anthropic` for our persona LLM per §8.
- **Distinct persona voices (§2):** TTS is BYOK-able to `ElevenLabsTTS` (`voiceId` per call) or stays on the managed `MiniMaxTTS` (`voiceId` per call) — either way, give each persona session its own `voiceId`.
- **Turn-taking / barge-in (R3), concretely:** `turnDetection.config` exposes `speech_threshold`, `start_of_speech.vad_config.interrupt_duration_ms` (how much speech before a barge-in registers), `start_of_speech.vad_config.prefix_padding_ms`, and `end_of_speech.vad_config.silence_duration_ms` (how long silence before the turn is considered over, feeding the "gentle re-prompt" behavior). These are per-session config, so each persona session can tune them independently if needed.
- **Transcript/state/metrics:** delivered over RTM (`advancedFeatures.enable_rtm: true`, `parameters.data_channel: 'rtm'`), including `AGENT_METRICS` — per-stage (STT/LLM/TTS) latency. This is a ready-made source for R10's event logging and a cheap "live pipeline latency" chip for R8 polish.
- **Known gotchas from the quickstart's own contributor guide (`AGENTS.md`)** worth knowing before Day 1: guard RTC join / mic-track hooks against React StrictMode double-invoking effects in dev; the transcript toolkit uses `uid="0"` as a sentinel for the local (candidate) speaker and it must be remapped to the real client uid before rendering, or candidate speech renders as if it came from the agent; `INTERRUPTED` turns must be kept in the transcript list (not filtered out with `IN_PROGRESS`-only logic) or an interrupted first turn leaves the transcript panel empty.
- **Session isolation, concretely:** the quickstart ships with a static test `channel_name` — that must be replaced with one generated fresh per session (e.g. `interview-<session_id>`, `session_id` created at Setup) before any multi-session testing, or two interviews will collide on the same Agora channel. Agora enforces channel isolation at the token level (a token minted for one channel can't join another), so once `channel_name` is unique per session, the 3 persona `agentUid`s and the shared-context store keyed by `session_id` (§3) give full isolation with no extra mechanism — see [tasks.md Day 1](./tasks.md#day-1--core-voice-loop-single-persona).

---

## 2. Personas

Fixed panel of 3, configurable per session (R9 setup flow):

| Persona | Focus | Voice | Behavior signature |
|---|---|---|---|
| **Technical** | Correctness, depth, tradeoffs | Voice A | Digs into "how," asks for specifics, escalates difficulty on strong answers |
| **Product** | Business impact, user value, prioritization | Voice B | Challenges "so what" — pushes technical answers toward customer/business framing |
| **Behavioral** | Collaboration, ownership, communication | Voice C | Scenario/role-play questions, watches for vague or generic answers |

Each persona has its own system prompt template (tone, question style, what it's scoring) but all read/write to the **same shared candidate context** (R4). Distinct TTS voices per persona are a cheap, high-impact way to make the panel feel real rather than being one voice narrating three roles.

---

## 3. Shared Candidate Context (R4)

A single structured object, updated after every candidate turn, readable by every persona and by the report generator. **Lives in Postgres**, in a `candidate_context` row keyed by `session_id` (JSONB column, or normalized into `claims`/`contradictions`/`competency_scores` tables — see schema note below); the browser holds a React-state copy for instant UI updates during the interview, refreshed from the server after each turn. The client sends the relevant slice of this object as part of the request body when it calls `/api/extract-claims` / `/api/compose-turn`; those routes call the LLM, then read-modify-write the `candidate_context` row in the same request before returning the updated fields — so a reload/reconnect rehydrates from the database rather than from browser storage (see §9).

**Schema note:** for hackathon-sprint velocity, store `candidate_context` as a single JSONB column (`sessions.context jsonb`) matching the shape below, rather than fully normalizing claims/contradictions/scores into separate tables. This keeps the extraction route's read-modify-write a single-row update, avoids join complexity under demo time pressure, and still lets the report route and any future analytics query into it with Postgres JSONB operators if needed.

```json
{
  "session_id": "string",
  "role_profile": { "title": "string", "focus_areas": ["string"] },
  "claims": [
    { "id": "c1", "text": "Built a caching layer that cut latency 40%",
      "persona_asked": "technical", "transcript_ref": "t=00:03:12",
      "confidence": "high", "specificity": "concrete" }
  ],
  "contradictions": [
    { "claim_a": "c1", "claim_b": "c7", "note": "Says caching was solo, later says pair-built", "flagged_at": "t=00:14:02" }
  ],
  "competency_scores": {
    "technical_depth": { "level": 3, "trend": "escalating" },
    "business_impact": { "level": 2, "trend": "flat" },
    "communication": { "level": 4, "trend": "escalating" }
  },
  "topics_covered": ["caching", "system design", "team conflict"],
  "handoff_log": [
    { "from": "technical", "to": "product", "reason": "business tradeoff surfaced", "t": "00:05:40" }
  ]
}
```

This object is the thing that makes "one panel" instead of "three bots" true — it's the design's central artifact. Every requirement in R2/R4/R5/R6 is implemented by reading or writing this structure.

---

## 4. Orchestrator: turn-taking & handoff logic (R2, R5)

The orchestrator is a lightweight controller (not a full state machine graph — keep it simple for hackathon scope) that **runs in the browser** (a plain TS module driven by RTM/transcript events), not as a standalone backend service, per §1. It calls `/api/extract-claims` and `/api/compose-turn` for the LLM steps below; those routes persist the resulting state updates (next speaker, handoff log, competency scores) into the `candidate_context` row (§3) in Postgres and return the updated slice, which the client mirrors into React state for the UI.

1. **Update context** — extract claims, check against existing claims for contradictions, update competency scores (LLM call: structured extraction, via `/api/extract-claims`).
2. **Decide next speaker** — default: current persona continues. Switch persona if:
   - the answer surfaces a topic clearly owned by another persona (e.g. business tradeoff → Product), or
   - the current persona has exhausted its planned focus areas, or
   - a scheduled rotation checkpoint is hit (time-boxed, e.g. every ~4 minutes).
3. **Decide question type** — deeper follow-up (if strong/vague answer) vs. new topic (if sufficiently covered) vs. challenge (if contradiction/gap found) — this drives R5 difficulty adjustment.
4. **Compose persona turn** — call the LLM with: persona system prompt + relevant slice of shared context + decided question type → next utterance → send to that persona's Agora agent to speak.

**The "panel dynamics" moment (UC-4)** is just this logic applied deliberately: when a claim is tagged with cross-functional relevance, trigger an *immediate* secondary reaction from the other persona in the same turn window, before returning control — this is the demo beat worth hand-tuning and rehearsing, not leaving to chance.

> **Risk — STT cost/duplication across "listening" personas.** If the 2 inactive persona sessions keep `remoteUids: [candidateUid]` live for the whole interview, they each run their own STT pipeline against the same candidate audio — up to 3x STT cost, and 3 separate transcript streams where §3 assumes one canonical transcript. Whether `start_of_speech.mode: "disabled"` (§1) also gates the STT call itself, or only suppresses the auto-response, needs to be confirmed on Day 0/1, not assumed. If STT still runs regardless, the cheaper design is: only the active persona's session subscribes to `remoteUids`/runs STT; the other two personas read the single canonical transcript from the shared-context store (§3) rather than running a parallel pipeline.

> **Risk — per-turn latency stacking.** Step 1 (context extraction) and step 4 (utterance composition) above are each a Claude API call, run sequentially with the speaker/question-type decisions in between, all before `session.say()` can fire. Stacked on Agora's own STT/TTS latency, this risks noticeable dead air between candidate answer and panel response — works against R3's "natural conversation" bar and is very visible in a live demo. Consider parallelizing extraction with composition where they don't depend on each other, or giving the active persona a fast-path (its own onboard LLM continues directly for simple follow-ups) and reserving the full orchestrator pipeline for actual handoff/challenge decisions.

---

## 5. Contradiction & Vagueness Detection (R4, R5)

Runs as part of step 1 above, as a structured LLM call (not a separate ML model — scope control for hackathon):

- **Vagueness check:** does the answer contain concrete specifics (numbers, names, decisions) or is it generic filler? → tag `specificity: concrete | vague`.
- **Contradiction check:** compare new claim against prior claims in context (semantic, not just keyword match) → if conflicting, write to `contradictions[]` with both transcript refs.

Both directly feed the follow-up decision (R5) and the report (R6).

> **Risk — false-positive contradictions are a live-demo liability.** A wrongly flagged "contradiction" in front of judges reads worse than missing a real one. Prompt this conservatively (require a clear, specific conflict, not just a topic overlap or a tone shift) and consider a confidence threshold below which nothing is flagged — this needs explicit tuning against rehearsal transcripts, not just "run a structured LLM call and trust the output."

---

## 6. Report Generation (R6)

Triggered automatically at session end (R1). Reads the final shared context and produces:

- **Competency breakdown** — score + trend per area, each backed by 1-3 linked claims with transcript timestamps.
- **Contradictions & vague-answer log** — explicit, not buried.
- **Panel narrative summary** — 3-5 sentences per persona ("Technical: ..."), generated once from the full context, not stitched from raw transcript.
- **Recommendation label** — framed as input to a human decision (R7), never a hire/no-hire verdict.

Output stored as structured data (so the UI can render it) + exportable as PDF/markdown (R6).

---

## 7. Frontend Design (R8, R9)

Three screens, one consistent design system (spacing scale, type scale, a small fixed color palette, one accent color per persona used consistently across transcript labels and the assessment panel).

### Setup screen (recruiter) — R9: ≤3 steps
1. Role + job description (role templates pre-filled for demo speed, so the recruiter edits rather than types from scratch)
2. Focus areas / competencies to probe (checkboxes, sane defaults pre-filled)
3. Confirm active personas → generates a session link (magic link: the candidate opens it straight into the mic-check + Join flow, never sees the Setup screen — R9)

### Live Interview screen (R8)
- Left/main: live transcript, speaker-labeled with persona color + icon, current speaker visually highlighted via the audio-reactive persona indicator (§7a) while that persona is "live."
- Right rail: live competency panel — each competency as a filling bar/radar point that updates as scores change, not just numbers. This is the single highest-leverage visual for "looks good" (R8) and for judges watching from a distance. **Wire path (resolved):** since there's no persistent backend to host a WebSocket/SSE connection (§1 — Vercel/Netlify serverless functions can't hold one open for the interview's duration), the orchestrator's client-computed `competency_scores` (§3) are published as custom RTM messages on the same Agora RTM channel already carrying transcript/metrics (§1a). Any view watching that channel (the candidate's own screen, or a recruiter's screen if it's a separate device) picks up updates in real time with no extra transport to build.
- Top: clear AI-disclosure banner, mic status indicator (R7, R9). Mic-check failures fail loud with an inline fix (permission prompt retry, device picker) — never a silent dead end, per R9.
- Subtle contradiction/flag indicator appears inline in the transcript when detected (small icon on the relevant line) — this is what turns "we detect contradictions" from a backend feature into something judges can *see* happen live.

### 7a. Persona visual presence (R8)

Each of the 3 personas gets an audio-reactive visual indicator instead of a static color chip — this is what makes the panel *feel* present while listening/speaking, not just a labeled transcript.

- **Library:** `@react-three/fiber` + `@react-three/drei` (React renderer for Three.js). Each persona renders as a distorted sphere (`MeshDistortMaterial` or a small custom shader) in its accent color; amplitude from a Web Audio `AnalyserNode` reading that persona's TTS/RTM audio stream drives the distortion/scale in real time. Idle personas get a slow, low-amplitude "breathing" animation so the panel never looks frozen.
- **Why this over a flat SVG pulse:** materially more visual payoff for judges watching from a distance, same rough effort (~a day including audio wiring), no new backend/vendor dependency.
- **Demo-hardware resilience:** feature-detect WebGL and fall back to a CSS pulse/glow on the persona's accent color if unavailable — cheap insurance against unfamiliar venue hardware, in the spirit of R10.
- **Why not a full 3D/photoreal avatar in the base build:** `agora-agents` does have native avatar vendor support (`.withAvatar()` — `LiveAvatarAvatar`/formerly HeyGen, `AkoolAvatar`, `AnamAvatar`, `GenericAvatar`), so it's technically a small code change, not custom rigging. But it means 3 separate BYOK vendor accounts (one per persona), sample-rate coordination with TTS (LiveAvatar requires 24kHz, Akool 16kHz), and 3 more live network dependencies on stage — real risk against R10 for a 1-week sprint, and outside what R8's acceptance criteria actually require. Scoped as **stretch-only**, buffer day, one persona as a spike before committing further — see [tasks.md Stretch goals](./tasks.md#stretch-goals-only-if-ahead-of-schedule).

### Report screen (recruiter)
- Header: role, candidate, date, overall summary.
- Competency cards, each expandable to show linked transcript quotes.
- Contradictions/flags section.
- Export button (PDF/markdown).

**Visual tone:** clean, modern SaaS aesthetic (think Linear/Vercel-style restraint) — generous whitespace, one accent color per persona, no visual clutter. Favor clarity over decoration; polish comes from consistency and motion (smooth live-updating panel), not from adding elements.

---

## 8. Tech Stack (proposed)

| Layer | Choice | Notes |
|---|---|---|
| Voice/RTC | Agora Conversational AI Engine, via the `agora-agents` npm SDK | mandatory per hackathon rules; scaffold from the official Next.js quickstart (§1a) instead of building token/join/invite plumbing from scratch |
| LLM (voice agent) | Claude, via `agora-agents`' native `Anthropic` vendor class (BYOK, `ANTHROPIC_API_KEY`) | persona system prompts spoken live in the interview (§1a) |
| LLM (orchestrator calls) | Claude (Sonnet) via the Anthropic API directly | context extraction, contradiction/vagueness detection, report generation — these are backend-only calls, not spoken, so they don't need to go through the agent pipeline |
| Backend | Next.js API routes (`app/api`) | proxies to Agora (token/invite/stop, still stateless) and Anthropic (extraction/composition/report); session/context/report routes additionally read-modify-write Postgres — matches the quickstart's `app/api` pattern, extended with a DB client |
| Database | **Postgres, hosted on Neon** | serverless Postgres — scale-to-zero keeps idle cost near zero between rehearsals, instant branching makes it cheap to test against a copy of demo data. Accessed via `node-postgres` (`pg`) or Drizzle ORM from API routes only, never from the browser |
| Orchestration & context store | Client-side React state (UI cache) backed by Postgres (`sessions`, `candidate_context` — §3) as source of truth | durability now covers reload, reconnect, *and* a different device/browser reopening the same session link |
| Auth | `localStorage`-only shared-passcode gate, if any gate exists at all | still no user accounts or password-based login — see §1 and requirements.md non-goals; this is independent of the Postgres session/context/report storage |
| Frontend | React + Next.js (App Router), Tailwind | matches the quickstart scaffold (§1a) — build the 3-screen product UI around its RTC/RTM/transcript plumbing rather than a separate Vite app |
| Persona visual (live interview) | `@react-three/fiber` + `@react-three/drei`, Web Audio `AnalyserNode` | audio-reactive per-persona indicator (§7a) — base build. Vendor avatars (`LiveAvatarAvatar`/`AkoolAvatar`/`AnamAvatar` via `agora-agents` `.withAvatar()`) are stretch-only |
| Report export | Report data read from Postgres via `/api/generate-report`; Markdown → PDF generated client-side (e.g. a browser PDF lib) from that data | server holds the durable copy; export stays a lightweight client-side rendering step, no server-side file storage needed |
| Deployment | Vercel or Netlify (frontend + serverless API routes) + Neon (managed Postgres, separate service) | quickstart ships a working `Deploy to Vercel` button and `vercel.json`; add `DATABASE_URL` (pooled) as an env var on the hosting platform. Must be reachable from the Delhi venue network reliably |

---

## 9. Reliability / Demo-Resilience Design (R10)

- **Reconnection:** if Agora connection drops (or the tab reloads, or the candidate reopens the session link on a different device), the client fetches the shared candidate context (§3) from Postgres via `/api/session/:id` — keyed by `session_id` — and attempts rejoin rather than restarting. This is strictly more resilient than a `localStorage`-only approach: it survives a lost/cleared browser, not just a reload in the same one. **Open question:** each agent session has `idleTimeout: 30` (seconds) — a drop longer than that likely ends the 3 agent sessions even though the server-side context in Postgres is untouched. Resuming may mean creating 3 fresh sessions and replaying the relevant context slice into each via `session.think()`/`session.update()` (§1) rather than literally the same sessions continuing. Needs to be decided and tested as an explicit failure case, not assumed to "just resume."
- **Event logging:** every persona handoff, tool call, and contradiction flag logged with timestamps to an `events` table in Postgres (session_id, event_type, payload, timestamp), written by the same API routes that update `candidate_context` — used for rehearsal debugging (queryable after the fact, not just in one browser's console) and optionally surfaced in the UI.
- **Fallback plan:** a fully recorded run of the golden-path demo, ready to play if live conditions fail at the finale. This is a presentation-safety requirement, not a code requirement — track it in tasks.md as a checklist item, not a build item.
- **Golden path rehearsal:** the demo script (which role, which answers, where the "panel dynamics" moment happens) should be rehearsed, not improvised — reduces variance in a live, judged setting.

---

## 10. Mentorship & Support Plan (Round 3)

Given only one scheduled 1:1 mentor session for the whole sprint, treat it as a scarce resource and route questions by type rather than defaulting everything to it:

| Question type | Channel | Example |
|---|---|---|
| Architecture-blocking, needs an authoritative answer | 1:1 mentor session (primary), Discord (if session hasn't happened yet) | Multi-agent-per-channel vs. hot-swap pattern (design §1) |
| SDK/API usage, error messages, "how do I..." | Agora Discord community | Tool-call plumbing syntax, STT/TTS config, barge-in tuning |
| Product/UX judgment calls | 1:1 mentor session (if slot remains) or team decision | Is 3 fixed personas the right scope, does the report format read as trustworthy |
| Schedule, deadlines, submission logistics | WhatsApp group | Submission deadline, format changes, program announcements |

**Before the mentor session:** have a written, prioritized question list ready (architecture question first) so the single slot isn't spent re-deriving context live. **After the mentor session:** post a summary of what was decided back to the team so the architecture choice (design §1) and any other guidance is recorded, not just remembered by whoever was on the call.

---

## 11. Traceability Summary

| Design section | Requirements covered |
|---|---|
| §1 Architecture | R1, R3 |
| §2 Personas | R2, R9 |
| §3 Shared Context | R4 |
| §4 Orchestrator | R2, R5 |
| §5 Detection | R4, R5 |
| §6 Report | R6, R7 |
| §7 Frontend | R7, R8, R9 |
| §7a Persona visual presence | R8 |
| §9 Reliability | R10 |
| §10 Mentorship & Support | R10, requirements.md §5 |
