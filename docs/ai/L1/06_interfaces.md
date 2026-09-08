# 06 Interfaces

> Contracts at repo boundaries: API routes, env vars, runtime events, and shared TypeScript payloads.

## HTTP Route Contracts

### `GET /api/generate-agora-token`

Query params:

- `uid` optional; invalid/zero resolves to random RTM-safe UID.
- `channel` optional; defaults to generated `ai-conversation-<ts>-<rand>`.

Success response:

```json
{ "token": "...", "uid": "1234", "channel": "ai-conversation-..." }
```

Failure response: `{ "error": string, "details"?: string }` with `500`.

### `POST /api/invite-agent`

Body (`ClientStartRequest`) — called on initial call start, on every mid-call persona switch, and to start the post-interview debrief agent:

```json
{
  "requester_id": "1234",
  "channel_name": "ai-conversation-...",
  "session_id": "uuid",
  "persona": "technical",
  "priorContext": "[Candidate]: ...\n[Technical]: ...",
  "fromPersona": "technical"
}
```

Only `requester_id` and `channel_name` are required. `session_id` loads `roleTitle` and `personaFocusAreas[persona]` (per-panelist, not the flat panel-wide `focusAreas` column) from Postgres (source of truth over any client-supplied values), and derives `isFirstActivePersona` (`activePersonas[0] === persona`) to control the introduction ask. `persona` defaults to `'technical'` when omitted. `priorContext`/`fromPersona` are present only on a persona switch — see [persona_handoff.md](L2/persona_handoff.md) — and drive both the injected "Conversation So Far" prompt section and a best-effort `handoff_log` write.

**Debrief variant**: `{ "requester_id", "channel_name", "session_id", "debrief": true, "debriefReport": DebriefReportPayload }`. When `debrief` is `true`, `persona`/`priorContext`/`fromPersona` are ignored, `debriefReport` is required (`400` if missing), and the route builds the prompt/greeting/voice via `buildDebriefSystemPrompt`/`buildDebriefGreeting`/`DEBRIEF_VOICE_ID` ([lib/personas.ts](../../../lib/personas.ts)) instead of the persona builders. `DebriefReportPayload` ([types/conversation.ts](../../../types/conversation.ts)) is structurally narrower than `FeedbackReport` — it omits `hiringScore` entirely, so the score can never reach the debrief prompt. Sent by `InterviewSession.handleTalkToPanel` after the candidate opts into the debrief from the `debrief-offer` stage.

Success (`AgentResponse`):

```json
{ "agent_id": "...", "create_ts": 1710000000, "state": "RUNNING" }
```

Validation failures return `400`; server failures return `500`. Full agent-construction detail in [invite_agent_config.md](L2/invite_agent_config.md).

### `POST /api/stop-conversation`

Body (`StopConversationRequest`): `{ "agent_id": "..." }`.

Responses:

- `{ "success": true }`
- `{ "success": true, "state": "already-stopping" }` for idempotent stop state
- `{ "error": string }` on failure

Called both on a persona switch (to stop the outgoing agent before inviting the next) and at call end.

### `POST /api/chat/completions`

Optional SSE proxy path (not default runtime path). Requires `NEXT_LLM_API_KEY` and `NEXT_LLM_URL` when used.

### `POST /api/session`

Body: `{ "recruiterEmail": string, "roleTitle": string, "focusAreas": string[], "activePersonas"?: PersonaId[], "personaDurations"?: Record<string, number>, "personaFocusAreas"?: Record<string, string[]> }`. `recruiterEmail` is required and must match a basic email pattern — `400` otherwise. `personaDurations` maps each active persona id to a whole-number minute budget (1–30); any entry missing or out of range defaults to 5 minutes rather than failing the request, mirroring how `activePersonas` already defaults. `personaFocusAreas` maps each active persona id to its own focus-area list (set per-panelist on `SetupScreen`); any entry missing defaults to an empty list. The flat `focusAreas` stored on the row is the derived union of `personaFocusAreas` (recomputed server-side if the per-persona map is empty, falling back to the client-sent flat list). Creates a `sessions` row (and an empty `candidateContext` row scaffolding `context: { handoff_log: [] }`), returns `{ "session": Session }`. This is the recruiter-facing entry point from `SetupScreen.tsx`, used to mint the candidate link (`/interview/[sessionId]`). `recruiterEmail` is stored for later use by `/api/session/[id]/report` — see below.

### `GET /api/session/[id]`

Returns `{ "session": Session, "context": CandidateContext['context'] | null, "completed": boolean }`, or `404` if the session doesn't exist. `session.recruiterEmail` is intentionally stripped before the response is sent — it's only needed server-side for the post-interview report email and is never exposed to the candidate-facing client. `completed` is `true` when a `reports` row already exists for this session id (checked via a `SELECT`, same one-row-per-session guarantee the report route's send-once gate relies on) — this is how the interview link becomes one-time-use: `InterviewSession.tsx` renders a "already completed" stage instead of `mic-check` when `completed` is true, blocking a second take through the same link. Used by `InterviewSession.tsx` on mount to load `roleTitle`/`focusAreas`/`activePersonas`/`personaDurations`/`personaFocusAreas` for the mic-check and conversation stages (the invite route separately reloads `personaFocusAreas[persona]` server-side by `session_id`, so the spoken prompt can't drift from what this response carries).

### `POST /api/session/[id]/report`

Body: `{ "transcript": ReportTranscriptTurn[], "candidateName"?: string }`. `400` if `transcript` is missing or empty; `404` if the session doesn't exist. `candidateName` (captured on the mic-check screen) is trimmed and passed through to `buildFeedbackReport({ roleTitle, candidateName, focusAreas, transcript })` ([lib/report.ts](../../../lib/report.ts)), so it appears in both the in-browser report and the recruiter email; omitted or blank names are simply left off the report (`candidateName` is optional on `FeedbackReport`). The result is upserted into `reports` (keyed by `sessionId`, `onConflictDoUpdate`) and returned as `{ "report": FeedbackReport }`. Called by `InterviewSession.handleEndConversation` right after the candidate ends the call — whether that call was triggered by the last persona's timer expiring or the candidate clicking "End conversation" (see [persona_handoff.md](L2/persona_handoff.md)). If this is the **first** report generated for the session (checked via a `SELECT` before the upsert — this is also what makes `GET /api/session/[id]`'s `completed` flag true from then on) and the session has a `recruiterEmail`, the route also fires `sendRecruiterReportEmail(recruiterEmail, report)` ([lib/mailer.ts](../../../lib/mailer.ts)) — fire-and-forget, never awaited by the response, and its own internal errors are caught and logged rather than propagated, so a Gmail SMTP failure never affects the candidate's report. A retried/regenerated report never re-sends the email.

### `GET /api/session/[id]/report`

Returns `{ "report": FeedbackReport }` if one is persisted for the session, else `404`. Allows reloading a previously generated report (e.g. a recruiter checking back later — no dedicated recruiter UI exists yet, but the data is queryable).

## Event/Data Interfaces

- RTM transcript/state/metrics/errors consumed through `AgoraVoiceAI` event emitter.
- Raw RTM `message` event parsed as fallback for `message.error` and `message.sal_status` payloads.
- `AGENT_METRICS` payloads displayed by `QuickstartPipelineMetrics`.

## Environment Contract

Required:

- `NEXT_PUBLIC_AGORA_APP_ID`
- `NEXT_AGORA_APP_CERTIFICATE`
- `DATABASE_URL` — Postgres connection string for `lib/db` (Drizzle). Required at runtime by every `/api/session*` route; without it session creation, persona switching, and report generation all fail.

Optional:

- `NEXT_LLM_API_KEY` / `NEXT_LLM_URL` — when both are set, `lib/report.ts` generates feedback reports via `generateText` instead of the deterministic heuristic builder, and `/api/chat/completions` becomes usable. Report generation degrades gracefully to the heuristic path when unset — it never blocks the candidate from seeing a report.
- `GROQ_API_KEY` — enables Groq-powered persona hand-off summarization and feedback reports (tried before `NEXT_LLM_API_KEY`). Falls back to the raw-transcript hand-off / `NEXT_LLM_API_KEY` / heuristic report when unset.
- `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` — Gmail SMTP credentials used by `lib/mailer.ts` to email the recruiter their detailed report after an interview ends. When either is unset, `sendRecruiterReportEmail` resolves to `false` without throwing — reports are still generated and shown to the candidate, just not emailed.

This is the full `.env.local` contract. See `env.local.example` for the annotated template.

## Test Coverage for Interfaces

- `scripts/verify-api-contracts.ts` asserts token generation, input validation, env failures, and SSE framing cases.

## Shared Client-Side Interfaces

From `types/conversation.ts` (high-use):

- `AgoraTokenData`: token bootstrap payload consumed by `InterviewSession`.
- `AgoraRenewalTokens`: renewal callback result (`rtcToken`, `rtmToken`).
- `ConversationComponentProps`: runtime dependencies for in-call component — `agoraData`, `rtmClient`, `onTokenWillExpire`, `onEndConversation(transcript: ReportTranscriptTurn[])`, `currentPersona`, `activePersonas`, `personaDurationsSeconds: Record<PersonaId, number>` (recruiter-configured per-persona time budget, drives the auto-switch countdown), `isSwitchingPersona`, `switchError`, `onSwitchPersona(next, transcriptText): Promise<boolean>`.
- `ReportTranscriptTurn`: `{ persona: PersonaId, speaker: 'candidate' | 'panelist', text: string }` — one attributed transcript line, built client-side via `getPersonaAtTimestamp` (see [persona_handoff.md](L2/persona_handoff.md)) and sent to `/api/session/[id]/report`.
- `FeedbackReport`: `{ roleTitle, candidateName?, overallSummary, focusAreaCoverage, personas: FeedbackReportPersonaSection[], source: 'llm' | 'heuristic', generatedAt, hiringScore }` — the persisted/returned report shape from `lib/report.ts`. `candidateName` is absent on reports generated before this field existed. `hiringScore` is recruiter-facing only (sent in the recruiter email via `lib/mailer.ts`) and must never reach the candidate — see the `DebriefReportPayload` note below and [08_security.md](08_security.md).
- `DebriefReportPayload`: `{ overallSummary, focusAreaCoverage, personas: Pick<FeedbackReportPersonaSection, 'label' | 'strengths' | 'concerns' | 'notableQuotes'>[] }` — structurally omits `hiringScore`, so it's impossible to pass the score into `POST /api/invite-agent`'s debrief path even by mistake. Built by `InterviewSession.handleTalkToPanel` from the already-generated `report` state.
- `DebriefCallProps`: `{ agoraData, rtmClient, onTokenWillExpire, onEndDebrief }` — props for `components/DebriefCall.tsx`, the post-interview debrief call component. No `PersonaId`/`activePersonas`/`personaDurationsSeconds` — the debrief is a single, un-timed segment (bounded only by a client-side safety-cap timer, not server-enforced).

## Interface Invariants

- Token payload must always include `token`, `uid`, `channel`.
- Invite route requires both `requester_id` and `channel_name`.
- Stop route requires `agent_id`; missing should never be tolerated silently.
- Token route should always return UID as string for downstream compatibility.

## Event Interface Notes

- Metrics stream entries are append-only in component state, capped to recent window.
- Connection issue records carry `source`, `agentUserId`, code/message, timestamp.
- SAL and signaling fallback payloads are parsed defensively because message schema can vary.

## Backward Compatibility Guidance

- If route response shape changes, update both client consumers and contract tests in same change.
- If adding fields, keep existing fields stable to avoid quickstart consumer breakage.
- Reflect interface changes in README and L1 docs to keep sample copyable.

## Related Deep Dives

- [conversation_lifecycle.md](L2/conversation_lifecycle.md) — How route contracts are used in sequence.
- [transcript_pipeline.md](L2/transcript_pipeline.md) — Event-level contract mapping.
- [invite_agent_config.md](L2/invite_agent_config.md) — Full `/api/invite-agent` construction detail.
- [persona_handoff.md](L2/persona_handoff.md) — Persona-switch request fields and context hand-off.
