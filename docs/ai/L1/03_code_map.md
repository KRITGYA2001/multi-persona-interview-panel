# 03 Code Map

> Directory-level ownership map and where to change behavior safely.

## Top-Level Layout

```text
app/                 Next.js routes + API handlers
components/          Client UI, RTC/RTM lifecycle, interview flow screens
lib/                 Shared constants, persona/report logic, DB access, transcript helpers
scripts/             Verification and doctor helpers
docs/                Human-oriented guides
docs/ai/             Progressive disclosure docs (this system)
public/              Static assets and branding
types/               Shared TypeScript route/component contracts
```

## API Route Ownership (`app/api`)

- `generate-agora-token/route.ts`: builds RTC+RTM token via `buildTokenWithRtm`.
- `invite-agent/route.ts`: validates input/env, loads session context from Postgres, builds the per-persona prompt/greeting/voice, configures and starts the agent session, writes `handoff_log` on a switch. See [invite_agent_config.md](L2/invite_agent_config.md).
- `stop-conversation/route.ts`: stops agent and handles idempotent already-stopping cases.
- `chat/completions/route.ts`: optional OpenAI-compatible SSE proxy for custom LLM path.
- `session/route.ts`: `POST` — recruiter creates a session (`recruiterEmail`, `roleTitle`, `focusAreas`, `activePersonas`, `personaDurations`, `personaFocusAreas`), scaffolds `candidateContext`. `focusAreas` is the derived union of `personaFocusAreas`, kept for consumers that don't need per-persona detail.
- `session/[id]/route.ts`: `GET` — loads a session (minus `recruiterEmail`, stripped server-side) plus its `candidateContext` for the candidate-facing flow.
- `session/[id]/report/route.ts`: `POST` — generates and persists the feedback report from a transcript, and (on the first report for a session) emails it to `recruiterEmail` via `lib/mailer.ts`; `GET` — returns a previously persisted report. Also reads `candidateContext.context.coding_question` and folds it into the report's `codingExercise` input when present.

## Client Ownership (`components`)

- `SetupScreen.tsx`: recruiter-facing two-column form (recruiter email, role title, persona panel with per-persona minute budgets *and* per-persona focus areas via `ROLE_TEMPLATES`), creates the session and produces the candidate link.
- `MicCheck.tsx`: candidate-facing mic-permission/device-check gate before joining the call.
- `InterviewSession.tsx`: central orchestrator for `/interview/[sessionId]` — owns `Stage` (`loading` / `not-found` / `completed` / `mic-check` / `conversation` / `debrief-offer` / `debrief` / `report` / `closed`), session/Agora bootstrap, persona-switch delegation, report generation, and the post-interview debrief offer/start/end flow. Converts `personaDurations` (minutes) to `personaDurationsSeconds` for `ConversationComponent`. Defers RTM logout/`agoraData` teardown past `handleEndConversation` so the connection survives into the debrief offer — only `handleSkipDebrief`/`handleEndDebrief` (or the no-transcript early return) tear it down. See [conversation_lifecycle.md](L2/conversation_lifecycle.md).
- `ConversationComponent.tsx`: RTC join, mic publish, toolkit init, transcript/metrics/issues state, `personaTimeline` tracking, and the countdown timer that drives automatic persona switching and automatic end-of-interview on the last persona's timeout. Also owns the live coding panel: eligibility (`isCodingPanelEligible`, a structural panelist-turn count, not content parsing) and its own auto-close timer — the round itself is voice-only, no autosave.
- `CodingQuestionPanel.tsx`: plain client component for the live coding round — question text, test examples, a remaining-time readout, and a static prompt telling the candidate to speak their solution aloud. No code editor, no typed input. Rendered via `QuickstartConversationLayout`'s `codingPanel` slot only while `showCodingPanel` is true.
- `PersonaSwitcher.tsx`: read-only pill row showing panel status and a live countdown on the active persona — no click/switch interaction; switching is timer-driven. See [persona_handoff.md](L2/persona_handoff.md).
- `DebriefCall.tsx`: self-contained post-interview debrief call — same StrictMode `isReady` guard, hook-ownership rules, and `AgoraVoiceAI` init pattern as `ConversationComponent.tsx`, but deliberately not built on it: no `PersonaId`, no persona timeline, no countdown/auto-switch, just join → converse → one manual "I'm Done" button plus a silent 4-minute safety-cap timer. Renders its own minimal transcript panel (via the `PersonaId`-free helpers in `lib/conversation.ts`) instead of reusing `QuickstartTranscriptPanel.tsx`, which is tied to `personaTimeline`.
- `InterviewReport.tsx`: candidate-facing end-of-call feedback report (overall summary, per-persona sections, focus-area coverage).
- `QuickstartConversationLayout.tsx`: in-call framing, header, and slots (including the `personaPanel` slot for `PersonaSwitcher`).
- `QuickstartTranscriptPanel.tsx`: live transcript panel, renders persona-switch dividers from `personaTimeline`.
- `QuickstartPipelineMetrics.tsx`: latency chips from metrics stream.
- `ConnectionStatusPanel.tsx` + `ConversationErrorCard.tsx`: issue rendering/severity.

## Shared Logic (`lib`)

- `agora.ts`: default constants (`DEFAULT_AGENT_UID` — fixed across all personas, see [persona_handoff.md](L2/persona_handoff.md)).
- `conversation.ts`: transcript normalization, spacing cleanup, timestamp normalization, visualizer state mapping, `getPersonaAtTimestamp`, `formatTranscriptForHandoff`.
- `personas.ts`: `PERSONA_DEFINITIONS`, `PERSONA_IDS`, `getPersonaDefinition`, `buildPersonaSystemPrompt`, `buildPersonaGreeting` — the source of truth for each persona's label/focus/voice/prompt. Also `DEBRIEF_VOICE_ID`, `DebriefReportInput` (structurally omits `hiringScore`), `buildDebriefSystemPrompt`, `buildDebriefGreeting` for the post-interview debrief agent, and `hasCodingFocusArea` plus an optional `codingQuestion` param on `buildPersonaSystemPrompt` for the live coding round — the coding-question prompt section instructs the candidate to speak their solution aloud and caps the persona at two follow-ups on it.
- `coding-question.ts`: `CodingQuestion`, `generateCodingQuestion(roleTitle, focusAreas)` — one easy-level question via `groqRespond`, falling back to a deterministic pick from a small hardcoded bank when `GROQ_API_KEY` is unset or the call/parse fails.
- `report.ts`: server-only; `buildFeedbackReport` (LLM path with heuristic fallback), `createFeedbackReportBuilder` (DI factory for tests). Accepts an optional `codingExercise` input, folded into the technical panelist's strengths/concerns on both the LLM and heuristic paths. Imports `ai`/`@ai-sdk/openai` — never import this from a client component.
- `mailer.ts`: server-only; `sendRecruiterReportEmail` — Gmail SMTP via `nodemailer`, resolves `false` (never throws) when `EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` are unset or the send fails. Never import this from a client component.
- `role-templates.ts`: `ROLE_TEMPLATES` — pre-filled role/per-persona-focus-area presets (`RoleTemplate.personaFocusAreas: Record<PersonaId, string[]>`) for `SetupScreen`.
- `db/schema.ts`: Drizzle schema — `sessions`, `candidateContext`, `reports`, `events`.
- `db/index.ts`: Drizzle/`pg` client, throws at import time if `DATABASE_URL` is unset.

## Validation and Tooling

- `scripts/verify-api-contracts.ts`: imports route handlers and validates contract behavior.
- `scripts/doctor.mjs`: local setup checks consumed by `pnpm run doctor`.
- `tailwind.config.ts`: includes `agora-agent-uikit` dist classes in content scan; maps semantic color tokens to the theme palette.

## Fast File Lookup

- Change a persona's prompt/focus/voice -> `lib/personas.ts`.
- Change agent construction, VAD, model/provider chain -> `app/api/invite-agent/route.ts` (see [invite_agent_config.md](L2/invite_agent_config.md)).
- Change token policy/channel naming -> `app/api/generate-agora-token/route.ts`.
- Change transcript mapping or persona attribution -> `lib/conversation.ts` + `components/ConversationComponent.tsx`.
- Change session bootstrap UX (candidate side) -> `components/InterviewSession.tsx`.
- Change recruiter setup UX -> `components/SetupScreen.tsx`.
- Change persona-switch/countdown UI -> `components/PersonaSwitcher.tsx`.
- Change auto-switch/auto-end timing logic -> `components/ConversationComponent.tsx` (see [persona_handoff.md](L2/persona_handoff.md)).
- Change feedback-report generation or shape -> `lib/report.ts` + `app/api/session/[id]/report/route.ts`.
- Change feedback-report UI -> `components/InterviewReport.tsx`.
- Change recruiter report email -> `lib/mailer.ts`.
- Change DB schema -> `lib/db/schema.ts` (update every route in `app/api/session*` together).
- Change the post-interview debrief agent's prompt/greeting/voice -> `lib/personas.ts` (`buildDebriefSystemPrompt`/`buildDebriefGreeting`/`DEBRIEF_VOICE_ID`).
- Change the debrief call UI or its offer/skip/end flow -> `components/DebriefCall.tsx` + `components/InterviewSession.tsx` (`handleTalkToPanel`/`handleSkipDebrief`/`handleEndDebrief`).
- Change the live coding question's keyword gate or generation -> `lib/personas.ts` (`hasCodingFocusArea`) + `lib/coding-question.ts` (`generateCodingQuestion`).
- Change the live coding panel's eligibility or timer -> `components/ConversationComponent.tsx`.
- Change the live coding panel UI -> `components/CodingQuestionPanel.tsx`.

## Additional Component Roles

- `QuickstartConversationLayout.tsx`: shared in-call composition shell.
- `MicrophoneSelector.tsx`: input-device selection UI.
- `ConnectionStatusPanel.tsx`: summary + detailed connection issue panel.
- `ErrorBoundary.tsx`: runtime guardrail for conversation subtree.
- `LoadingSkeleton.tsx`: loading placeholder used across setup/mic-check/report stages.

## Type Contract Locations

- `types/conversation.ts`: request/response payloads and component prop types, including `FeedbackReport`, `ReportTranscriptTurn`, `ClientStartRequest` (persona-switch fields). `AgentResponse.codingQuestion?: CodingQuestion` and `ConversationComponentProps.codingQuestion?` carry the live coding question down to the client (`CodingQuestion` itself is defined in `lib/coding-question.ts`).
- `types/env.d.ts`: typed environment variable expectations.
- `types/jsx.d.ts` and `react-jsx.d.ts`: JSX typing support details.

## Static and Styling Assets

- `public/*`: icons, logos, and heading SVG assets used in setup/mic-check/in-call/report experiences.
- `app/globals.css` and `styles/globals.css`: baseline theme/layout styles, including the Multi Persona color palette tokens.
- `tailwind.config.ts`: utility class scan and theme extension.

## Verification Path Mapping

- API contract behavior test: `scripts/verify-api-contracts.ts`.
- Environment and prerequisites check: `scripts/doctor.mjs`.
- Aggregate check chain: `pnpm run verify` script in `package.json`.

## Ownership Boundaries

- `components/` owns client runtime lifecycle and UI state.
- `app/api/` owns privileged operations needing the app certificate or DB access.
- `lib/` owns pure transforms and server-side logic reusable across routes/components (note: `lib/report.ts` and `lib/db/*` are server-only).
- `docs/` owns human-facing implementation narrative and runbooks.

## Related Deep Dives

- [conversation_lifecycle.md](L2/conversation_lifecycle.md) — Cross-file call path during start/switch/stop/report.
- [from_scratch_bootstrap.md](L2/from_scratch_bootstrap.md) — Official baseline map for recreating the quickstart recipe.
- [transcript_pipeline.md](L2/transcript_pipeline.md) — Mapping and rendering flow from toolkit events.
- [invite_agent_config.md](L2/invite_agent_config.md) — Agent construction and per-persona config.
- [persona_handoff.md](L2/persona_handoff.md) — Persona switch mechanism and context hand-off.
