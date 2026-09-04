# 02 Architecture

> Runtime architecture for browser RTC/RTM, Next.js route handlers, Postgres session storage, and the Agora managed agent session.

## High-Level Shape

- Next.js App Router frontend and API routes in one deployable app.
- Postgres (Drizzle ORM) stores `sessions`, `candidateContext`, `reports`, `events` — the durable state behind a recruiter-created interview link.
- Browser joins Agora RTC channel and uses RTM for transcript/state/metrics/errors.
- Server-side routes mint token, load/persist session state, and call Agora Agent Server SDK.
- Agent executes STT -> LLM -> TTS pipeline in Agora cloud, on one of three interviewer personas at a time.

## Component Graph

```text
Recruiter: SetupScreen (recruiter email, role, focus areas, per-persona minute budgets)
  -> POST /api/session (create sessions + candidateContext rows)
  -> candidate link /interview/[sessionId]

Candidate: MicCheck -> InterviewSession
  -> GET /api/session/[id]                (load roleTitle/focusAreas/activePersonas/personaDurations)
  -> GET /api/generate-agora-token
  -> POST /api/invite-agent               (start first persona's agent session)
  -> RTC join/publish mic
  -> RTM subscribe + AgoraVoiceAI events
  -> ConversationComponent renders PersonaSwitcher (read-only countdown status)
       -> countdown hits zero -> POST /api/stop-conversation + POST /api/invite-agent (timer-driven persona switch, see persona_handoff.md)
       -> last persona's countdown hits zero -> automatic interview end (same path as the manual "End conversation" button)
  -> POST /api/stop-conversation           (call end, timer-driven or manual; RTM/agoraData NOT yet torn down)
  -> POST /api/session/[id]/report         (generate + persist feedback report; emails recruiterEmail via lib/mailer.ts on first report)
  -> debrief-offer stage: "Talk to the panel" / "Skip to my written report"
       -> Talk: POST /api/invite-agent (debrief: true, debriefReport) -> DebriefCall (same join/mic/AgoraVoiceAI pattern as ConversationComponent, no persona timeline) -> manual "I'm Done" or 4-min safety-cap timer -> POST /api/stop-conversation -> RTM logout
       -> Skip: RTM logout immediately
  -> InterviewReport renders the result

Next.js API routes
  -> agora-token (RtcTokenBuilder.buildTokenWithRtm)
  -> agora-agents (start/stop managed agent, per persona)
  -> lib/db (Drizzle/Postgres: sessions, candidateContext, reports)
  -> lib/report.ts (LLM or heuristic feedback report)
  -> lib/mailer.ts (recruiter report email, best-effort)

Agora Cloud
  -> Agent session (Deepgram STT + OpenAI LLM + MiniMax TTS, one persona's voice at a time)
  -> RTM payloads (transcript, state, metrics, error)
```

## Start Sequence

1. Candidate opens `/interview/[sessionId]`; `InterviewSession` fetches `GET /api/session/[id]` for `roleTitle`/`focusAreas`/`activePersonas`/`personaDurations`.
2. `MicCheck` stage confirms mic access, then `InterviewSession.startConversation()` runs.
3. UI fetches RTC+RTM token and invites the first persona's agent (`persona` = first entry in `activePersonas`) in parallel with RTM client setup.
4. UI mounts `ConversationComponent`.
5. `useJoin` connects RTC once `isReady` guard passes.
6. `AgoraVoiceAI.init()` subscribes transcript/state/metrics streams.

## Persona Switch Sequence (mid-call)

See [persona_handoff.md](L2/persona_handoff.md) for full detail. Summary: `ConversationComponent` runs a per-persona countdown seeded from `personaDurationsSeconds`; when it reaches zero, `ConversationComponent` formats a hand-off transcript -> `InterviewSession` stops the current agent and invites the next persona with `priorContext`/`fromPersona` set -> on success, `ConversationComponent` appends to its local `personaTimeline` and resets the countdown for the new persona. If the persona that just timed out was the last one in `activePersonas`, the interview ends automatically instead (the same `handleEndConversation` path the manual "End conversation" button uses). The RTC/RTM connection is never torn down — only the agent session and persona state change. The candidate can still end early at any time via "End conversation," which short-circuits the countdown.

## End Sequence

1. UI calls `/api/stop-conversation` with `agent_id` if present.
2. `ConversationComponent` builds a persona-tagged transcript (`ReportTranscriptTurn[]`, via `getPersonaAtTimestamp`) and calls `onEndConversation(transcript)`.
3. `InterviewSession.handleEndConversation`: if there's no session or an empty transcript, it logs out RTM/nulls `agoraData` immediately and returns to `'mic-check'`. Otherwise it transitions to `'debrief-offer'` and `POST`s the transcript to `/api/session/[id]/report` — **RTM/`agoraData` teardown is deferred**, not skipped, because the RTC/RTM connection needs to stay alive for a possible debrief.
4. Once the report resolves, the candidate sees "Talk to the panel about it" / "Skip to my written report":
   - **Skip** (`handleSkipDebrief`): logs out RTM, nulls `agoraData`, transitions to `'report'`. This is the point equivalent to the old (pre-debrief) end sequence's teardown step.
   - **Talk** (`handleTalkToPanel`): `POST /api/invite-agent` with `debrief: true` and a `DebriefReportPayload` (built from `report`, excluding `hiringScore`) on the same channel/UID; on success transitions to `'debrief'` and mounts `DebriefCall`, which joins/converses exactly like `ConversationComponent` but with no persona timeline or countdown. The debrief ends via a manual "I'm Done" button or a silent 4-minute safety-cap timer, both calling `handleEndDebrief`, which stops the debrief agent, logs out RTM, nulls `agoraData`, and transitions to `'report'`.
5. `InterviewReport` renders with the result (or a heuristic-fallback/error state) regardless of which debrief path was taken.
6. `InterviewReport`'s "Done" action does not reset back to `'mic-check'` — the link is one-time-use (see [07_gotchas.md](07_gotchas.md)); it attempts `window.close()` and falls back to a "you may close this tab" stage.

## Core State Domains

- Session bootstrap: `InterviewSession` (`session`, `agoraData`, `rtmClient`, `currentPersona`, loading/error flags, `Stage`).
- RTC transport and mic: `ConversationComponent` + `agora-rtc-react` hooks.
- Persona state: `currentPersona`, `isSwitchingPersona`, `switchError` (owned by `InterviewSession`); `personaDurationsSeconds` (owned by `InterviewSession`, converted from the minutes fetched via `GET /api/session/[id]`); `remainingSeconds` and `personaTimeline` (owned by `ConversationComponent` — `remainingSeconds` drives the countdown/auto-switch/auto-end timer, `personaTimeline` is used for transcript attribution — see [persona_handoff.md](L2/persona_handoff.md)).
- Transcript + agent state: `AgoraVoiceAI` events mapped through `lib/conversation.ts`.
- Metrics and connection issues: `AGENT_METRICS`, `MESSAGE_ERROR`, `SAL_STATUS`, RTM fallback parsing.
- Feedback report: `report`, `isGeneratingReport`, `reportError` (owned by `InterviewSession`).

## External Dependencies

- `agora-rtc-react` / `agora-rtc-sdk-ng` for media transport.
- `agora-rtm` for data channel.
- `agora-agent-client-toolkit` and `agora-agent-uikit` for conversation logic/UI.
- `agora-agents` for managed agent lifecycle.
- `drizzle-orm` + `pg` for Postgres access (`sessions`, `candidateContext`, `reports`, `events`).
- `ai` + `@ai-sdk/openai` for the optional LLM-generated feedback report path (falls back to a deterministic heuristic when unset).
- `nodemailer` for the optional recruiter report email (`lib/mailer.ts`, Gmail SMTP, falls back to a no-op when `EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` are unset).

## Deployment Modes

- Local development via `pnpm run dev`.
- Vercel deployment as single Next.js app with server env vars, including `DATABASE_URL` pointed at a Postgres instance (e.g. Neon).

## Data and Control Boundaries

- Browser never sees the app certificate or DB credentials; only receives signed short-lived tokens and JSON responses.
- Agent lifecycle control (`start`, `stop`) is server-routed.
- Session/role/focus-area truth lives in Postgres, loaded server-side by `session_id` — never trusted from client-supplied fields.
- Transcript/state/metrics are data-plane RTM events from agent to browser.
- UI control-plane actions (start/end/switch, renew) originate in `InterviewSession`/`ConversationComponent`.

## Internal Interfaces Between Components

`InterviewSession` -> `ConversationComponent` props (`ConversationComponentProps`):

- `agoraData` (`token`, `uid`, `channel`, optional `agentId`)
- `rtmClient` (already logged-in and subscribed)
- `onTokenWillExpire(uid)` callback for dual-token renewal
- `onEndConversation(transcript: ReportTranscriptTurn[])` callback for teardown, route stop call, and report generation
- `currentPersona`, `activePersonas` — which panelist is live and which come next in rotation
- `personaDurationsSeconds` — recruiter-configured per-persona time budget, seeds the countdown that drives auto-switch/auto-end
- `isSwitchingPersona`, `switchError` — in-flight/error state for the switch UI
- `onSwitchPersona(next, transcriptText): Promise<boolean>` — delegates the actual stop/invite calls up to `InterviewSession`, called internally by `ConversationComponent` when a countdown reaches zero (no longer candidate-triggered)

`ConversationComponent` -> child UI components:

- normalized transcript items and current in-progress turn, with persona attribution via `personaTimeline`
- agent visualizer state derived from transport + semantic state
- connection issue list and derived severity
- recent metric window for stage latency chips
- `PersonaSwitcher` (read-only pill row showing panel status and a live countdown badge on the active persona — no click/switch interaction)

## Why the App Router Structure Matters

- API handlers under `app/api` co-deploy with UI and share env management.
- Client components isolate browser-only SDK usage via dynamic import and `ssr: false`.
- This avoids SSR-side access to WebRTC-dependent modules.
- `lib/report.ts` is server-only (imports `ai`/`@ai-sdk/openai`) — its `ReportTranscriptTurn` type lives in `types/conversation.ts` instead, so client components can import the type without pulling in server-only code.

## Change Impact Hints

- Changes to token or invite routes affect both startup and renewal paths, and every persona switch.
- Changes to transcript mapping can break both transcript panel and visualizer semantics, and end-of-call report attribution.
- Changes to RTM setup in `InterviewSession` affect toolkit subscription readiness.
- Changes to `lib/personas.ts` (prompt/greeting/voice building) affect every persona's behavior, both cold-open and hand-off.
- Changes to the `sessions`/`candidateContext`/`reports` schema require touching every route in `app/api/session*` together.
- Changes to `FeedbackReport`'s shape require updating `lib/mailer.ts`'s render functions alongside `InterviewReport.tsx`, or the recruiter email falls out of sync with the candidate-facing report.

## Related Deep Dives

- [conversation_lifecycle.md](L2/conversation_lifecycle.md) — Detailed bootstrapping, switch, and teardown timeline.
- [transcript_pipeline.md](L2/transcript_pipeline.md) — Event mapping, UID remap, in-progress/completed segmentation.
- [invite_agent_config.md](L2/invite_agent_config.md) — Agent construction, per-persona prompt/voice, session options.
- [persona_handoff.md](L2/persona_handoff.md) — Persona switch sequence, fixed-agentUID rationale, context hand-off.
