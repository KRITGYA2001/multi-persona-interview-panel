# Tasks — Panel: Coordinated AI Interview Panel

Companion to [requirements.md](./requirements.md) and [design.md](./design.md). Each task references the requirement(s) it satisfies. Suggested owner tags — **[V]** voice/Agora, **[B]** backend: API routes + Postgres/Neon (Next.js `app/api`, database schema/queries — design.md §1, §3), **[F]** frontend (client-side orchestration + UI state, synced to the backend) — map to your team's strengths; reassign as needed.

Checkboxes are for your team to tick off as you go.

This is a **one-week online development sprint** (Round 3). You get one scheduled 1:1 mentor session for the whole week, plus async access to the Agora Discord community (technical support) and the official WhatsApp group (announcements, product guidance, mentor scheduling/comms) — see [requirements.md §5](./requirements.md#5-round-3--development-sprint-program-context) and [design.md §10](./design.md#10-mentorship--support-plan-round-3) for the full plan on using these well.

---

## Day 0 — Before you write code

- [ ] **[All]** Join the Agora Discord community and the official WhatsApp group if you haven't already; make sure all 3 team members are in both.
- [ ] **[All]** Request/confirm the scheduled time for your team's 1:1 mentor session as early as possible — it's one slot for the whole week, so lock it in now rather than later.
- [ ] **[V]** Scaffold the project from the official reference quickstart instead of building token/RTC-join/agent-invite plumbing by hand: `agora init my-panel --template nextjs` (needs the Agora CLI + `agora login` + an Agora Console project), or `git clone https://github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs` and wire credentials with `agora project use <project> && agora project env write .env.local` — design.md §1a.
- [ ] **[V]** `pnpm install && pnpm dev`, open `http://localhost:3000`, click **Start conversation**, confirm the default single-agent demo works end to end (this validates Agora credentials + the base pipeline before any of our own code is added). If it doesn't join, run `agora project doctor --deep`.
- [ ] **[V]** Quick-confirm the architecture question (design.md §1) for real, don't just discuss it: try calling `agent.createSession()` a second time with a different `agentUid` on the *same* `channel_name` while the first session is still running, and see if both join. This is now expected to work based on the SDK's per-session `agentUid`/`remoteUids` contract (design.md §1a) — if it's rejected or behaves unexpectedly, that's the thing to bring to the mentor session/Discord, not the question itself.
- [ ] **[All]** Post to Agora Discord immediately if the 2-session test above doesn't work cleanly — don't wait on the mentor session slot to find out.
- [ ] **[V]** Quick-confirm turn arbitration for real: on the 2 concurrent sessions from the test above, set one session's `turnDetection.config.start_of_speech.mode` to `"disabled"` and confirm (a) it stops auto-generating a spoken reply to candidate audio, and (b) whether its STT still runs/costs against that audio or is also suppressed. Confirm `session.say()` and `session.think()` behave as documented for driving a specific persona's speech externally — design.md §1. If STT still runs when SoS is disabled, flag the 3x-STT-cost tradeoff and default to only the active persona subscribing to `remoteUids` (design.md §4).
- [ ] **[All]** Confirm LLM provider access/API keys (Anthropic, for the `Anthropic` vendor class in `agora-agents` — design.md §8) and Agora project credentials are working for all 3 team members.
- [ ] **[B]** Set up shared repo (based on the scaffolded quickstart above), and a shared `.env.example` covering `NEXT_PUBLIC_AGORA_APP_ID`, `NEXT_AGORA_APP_CERTIFICATE`, `ANTHROPIC_API_KEY`, `DATABASE_URL` (pooled), and `DATABASE_URL_UNPOOLED` (direct, for migrations).
- [ ] **[B]** Provision the Neon Postgres project, set up Drizzle (schema in code, `drizzle-kit push`/`generate`+`migrate`), and define the initial schema: `sessions` (id, role_profile, focus_areas, active_personas, created_at), `candidate_context` (session_id FK, context jsonb, updated_at), `reports` (session_id FK, report jsonb, created_at), `events` (session_id FK, event_type, payload jsonb, created_at) — design.md §3, §8.
- [ ] **[V/B]** Replace the quickstart's static test `channel_name` with one generated fresh per `session_id` (e.g. `interview-<session_id>`) before any multi-session testing — session isolation depends on this being unique per interview, not shared/hardcoded — design.md §1a.
- [ ] **[All]** Agree on the demo script: role being interviewed, rough candidate answers, and exactly where the "panel dynamics" moment (UC-4) will be triggered. Write it down.

---

## Day 1 — Core voice loop (single persona)

**Goal: one persona can hold a real, interruptible voice conversation end-to-end.**

- [ ] **[V]** In `app/api/invite-agent/route.ts`, swap the default `OpenAI` LLM vendor for `Anthropic` (`ANTHROPIC_API_KEY`, e.g. Claude Sonnet) and replace the quickstart's `ADA_PROMPT` with the Technical persona's system prompt — design.md §1a, §2
- [ ] **[V]** Verify barge-in / interruption works (candidate talking over the agent stops it) — tune `turnDetection.config` (`interrupt_duration_ms`, `silence_duration_ms`) if it feels too twitchy or too slow — R3, design.md §1a
- [ ] **[V]** Verify silence handling (gentle re-prompt via `silence_duration_ms`, not a hard timeout) — R3
- [ ] **[V]** Confirm the persona asks role-relevant questions using the swapped-in Technical system prompt — R2
- [ ] **[F]** Apply the quickstart's known gotchas while wiring the Live Interview screen: StrictMode double-invoke guard on join/mic hooks, remap the transcript toolkit's `uid="0"` sentinel to the real candidate uid, and keep `INTERRUPTED` turns in the transcript list — design.md §1a
- [ ] **[B]** Implement `POST /api/session` (create — writes `sessions` row, returns `session_id`) and `GET /api/session/:id` (read — returns session config + current `candidate_context`) — R1, R9, design.md §1, §3
- [ ] **[F]** Store session config (role, focus areas, active personas) via `POST /api/session`; encode only `session_id` into the generated link — R1, R9, design.md §1
- [ ] **[F]** Hold shared candidate-context as client-side React state for the live UI, hydrated from `GET /api/session/:id` on load/reconnect and refreshed after each `/api/extract-claims` call — R4
- [ ] **[B]** Implement `/api/extract-claims` (structured-extraction LLM call): client sends latest utterance + session_id, route calls the LLM, then read-modify-writes the `candidate_context` row in Postgres and returns the updated claims/scores — R4, design.md §4
- [ ] **[F]** Build Setup screen: role (pre-filled templates) + focus areas + persona selection → generates a magic session link (≤3 steps) — R9, R8, design.md §7
- [ ] **[F]** Build candidate mic-check on session-link open: clear inline fix (permission retry, device picker) on failure, never a silent dead end — R9
- [ ] **[F]** Build barebones Live Interview screen: connect to Agora channel, show raw transcript — R1, R8
- [ ] **[All]** End-to-end smoke test: setup → join → single-persona conversation → transcript visible
- [ ] **[All]** Once the 1:1 mentor session happens, post a short summary back to the team (architecture decision + any other guidance) so it's recorded, not just remembered by whoever was on the call — design.md §10

---

## Day 2 — Multi-persona orchestration

**Goal: the panel behaves like a panel, not three isolated bots.** Hit an SDK/API blocker? Post it to Agora Discord rather than sitting on it — the mentor session is spent, so Discord is now your primary technical-support channel for the rest of the week.

- [ ] **[V/B]** Stand up the 2nd and 3rd persona agent sessions (Product, Behavioral): same `channel_name`, distinct `agentUid` per persona, distinct `voiceId` per persona (MiniMax managed or ElevenLabs BYOK) per the Day 0 architecture confirm — R2, design.md §1a, §2
- [ ] **[F]** Wire the live-competency-panel transport: publish the client-side orchestrator's `competency_scores` (design.md §3) as custom RTM messages on the existing Agora RTM channel — no backend, no separate SSE/WebSocket (resolved in design.md §7). Build this before the competency panel UI (Day 3) so it isn't blocked.
- [ ] **[F]** Implement orchestrator turn-taking logic client-side: decide next speaker after each turn (design.md §4) — R2, R5
- [ ] **[F]** Implement handoff mechanism: only the active persona's session should be audibly "speaking" — decide whether that means muting inactive sessions' audio output client-side or literally starting/stopping sessions per turn; pass relevant context slice so the new persona references prior context, not a cold start — R2
- [ ] **[F]** Implement difficulty-adjustment logic client-side: escalate on strong answers, probe on vague/weak answers — R5
- [ ] **[B]** Implement `/api/compose-turn`: given persona + session_id + decided question type, read context from Postgres, return the next utterance (called from the client orchestrator) — design.md §4
- [ ] **[F]** Implement vagueness detection (concrete vs. generic answer tagging), reading the `/api/extract-claims` result into client-side context — R4, R5
- [ ] **[F]** Implement contradiction detection against prior claims in shared context (client-side, from `/api/extract-claims` output) — R4
- [ ] **[F]** Implement the "panel dynamics" trigger: cross-functional claim → immediate secondary persona reaction in the same turn window — R2, UC-4
- [ ] **[F]** Add persona speaker labeling to transcript (color/icon per persona) — R8
- [ ] **[F]** Build the audio-reactive persona indicator with `@react-three/fiber` + `@react-three/drei`: distorted sphere per persona in accent color, driven by a Web Audio `AnalyserNode` on that persona's TTS stream, idle "breathing" animation when not speaking — R8, design.md §7a
- [ ] **[F]** Add AI-disclosure banner + mic status indicator to Live Interview screen — R7, R9
- [ ] **[All]** Rehearse the scripted "panel dynamics" moment end-to-end at least twice — UC-4

---

## Day 3 — Report, polish, resilience

**Goal: the whole flow looks and feels finished, and survives a live demo.**

- [ ] **[B]** Implement `/api/generate-report`: reads the final `candidate_context` from Postgres, generates competency breakdown, linked transcript evidence, contradictions/vague-answer log, panel narrative summary, writes the result to the `reports` table, returns it — R6, design.md §6
- [ ] **[F]** Add "recommendation, not verdict" framing to report output — R7
- [ ] **[F]** Implement client-side export (PDF/markdown) for the report from the returned report data — R6
- [ ] **[F]** Build Report screen: header, expandable competency cards with linked quotes, contradictions section, export button — R6, R8
- [ ] **[F]** Build live competency panel on the Live Interview screen (filling bars/radar, updates in real time) — R8
- [ ] **[F]** Add inline contradiction/flag indicator in the live transcript — R8, UC-4
- [ ] **[F]** Pass over all 3 screens for one consistent design system (type scale, spacing, color palette, persona accent colors) — R8
- [ ] **[F]** Implement reconnection handling: on drop/reload, rehydrate shared context from `GET /api/session/:id` (Postgres) and resume — R10. Explicitly handle the case where the drop exceeds each agent session's `idleTimeout` (30s default) — recreate the 3 sessions and replay context via `session.think()`/`session.update()` rather than assuming the original sessions survive — design.md §9
- [ ] **[B]** Add server-side session event logging: write handoffs, tool calls, and flags to the `events` table from the relevant API routes, for rehearsal debugging — R10
- [ ] **[All]** Full run-through, setup → interview → report, with zero manual intervention — R1, R10 (Success Criteria)

---

## Buffer day — Rehearsal & demo safety net

- [ ] **[All]** Check the WhatsApp group for final submission requirements (format, deadline, what to include) — confirm before assuming the demo/report flow is the full deliverable.
- [ ] **[B]** Check Agora/Anthropic cost and rate-limit headroom against actual usage: 3 concurrent agent sessions × multiple Claude calls per turn (extraction + composition) × ≥5 full rehearsal run-throughs — confirm no quota wall hits mid-rehearsal.
- [ ] **[All]** Run the full golden-path demo at least 5 times end-to-end, timing it — Success Criteria
- [ ] **[All]** Record a full backup demo video in case of live network/audio failure at the Delhi finale — R10
- [ ] **[F]** Final visual QA pass: check on the actual screen/resolution you'll demo on — R8
- [ ] **[All]** Prepare a 60-90 second spoken narrative for judges: problem → what makes this a *panel* not a bot → live demo → report → close
- [ ] **[All]** Stress-test edge cases you plan to demo: interrupting mid-sentence, contradicting an earlier answer, giving a vague answer — R3, R4, R5
- [ ] **[All]** Confirm venue wifi fallback plan (hotspot, ethernet, or the recorded video) before you're on stage

---

## Stretch goals (only if ahead of schedule)

- [ ] Multi-language support for the interview (ties into Agora's multilingual capabilities, borrows from Track 4's spirit) — not required for Track 2, but a differentiation lever if time allows
- [ ] Recruiter live-override control (e.g. "skip to Behavioral now") during the session — R7-adjacent human-in-the-loop control
- [ ] Recruiter dashboard listing past interviews across sessions (now cheap to add — `reports`/`sessions` are already in Postgres, just needs a list view + query)
- [ ] Photoreal persona avatars via `agora-agents` `.withAvatar()` (`LiveAvatarAvatar`, `AkoolAvatar`, or `AnamAvatar`) — spike one persona first (match TTS sample rate to the vendor's requirement) before committing to all 3; only pursue if Day 3 finishes early — design.md §7a
