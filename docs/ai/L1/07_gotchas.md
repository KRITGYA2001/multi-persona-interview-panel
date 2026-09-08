# 07 Gotchas

> High-impact pitfalls that regularly break session startup, transcript rendering, or lifecycle cleanup.

## Critical Runtime Pitfalls

- Using RTC-only token generation breaks RTM login and transcript/state events.
- Removing `isReady` guard can trigger StrictMode double-initialization and duplicate/missing tracks.
- Manual `client.leave()` conflicts with `useJoin` cleanup contract.
- Manual `localMicrophoneTrack.close()` conflicts with hook-owned lifecycle.
- **`next/dynamic()`'s loader must be a plain `() => import('module')` expression, never an `async () => { ... await import(...) ... }` function body.** Next's build-time chunk-manifest registration only recognizes the direct-return shape; an async function body that performs the import internally (even if it still resolves to a valid `{ default: Component }`) can fail to register a production Turbopack chunk correctly, so the component resolves to `undefined` at runtime and React throws error #130 ("Element type is invalid") — while working fine in `next dev`, since dev mode doesn't depend on the static manifest. `AgoraProvider` used to be defined this way inline inside `InterviewSession.tsx` (wrapping a runtime `await import('agora-rtc-react')`); it's now its own file, [components/AgoraProvider.tsx](../../../components/AgoraProvider.tsx), imported via the plain `dynamic(() => import('./AgoraProvider'), { ssr: false })` form, matching `ConversationComponent`'s already-correct pattern.

## Transcript Pitfalls

- Not remapping toolkit `uid="0"` causes user turns to render as agent turns.
- Dropping `INTERRUPTED` from message history can keep transcript panel from auto-opening on first interrupted turn.
- Skipping punctuation/timestamp normalization creates inconsistent transcript readability and issue time ordering.

## Agent Startup Pitfalls

- Missing `NEXT_PUBLIC_AGORA_APP_ID`/`NEXT_AGORA_APP_CERTIFICATE` yields hard 500s on token/invite/stop routes.
- Missing `DATABASE_URL` throws at import time in `lib/db/index.ts` — every `/api/session*` route (including `invite-agent`'s session-context lookup) fails immediately, not just DB-facing routes.
- Changing the agent UID outside `lib/agora.ts` can desynchronize the browser and invite route.
- **`agentUid` must stay `String(DEFAULT_AGENT_UID)` for every persona, never vary it per persona.** `ConversationComponent.tsx` hardcodes this same constant for `user-joined`/`user-left` presence detection and transcript speaker-side rendering. A persona switch is a stop-and-restart of one agent session on this fixed UID — varying it per persona would desync presence detection and break transcript attribution (which instead relies on the client-side `personaTimeline`, not the UID). See [persona_handoff.md](L2/persona_handoff.md).
- RTM subscription failures may only surface through SAL status or raw signaling fallback events.

## Persona Switch & Report Pitfalls

- **`focusAreas` passed to `buildPersonaSystemPrompt` must be `session.personaFocusAreas[personaId]` (per-panelist), never the flat `session.focusAreas` column** — the flat column is a derived union across all personas, so building a prompt from it would let a persona ask about another panelist's topics, defeating the hard-constraint scoping. The flat column stays valid only for consumers that genuinely want the whole-panel list (`lib/report.ts`, `candidateContext.role_profile.focus_areas`).
- **`isFirstActivePersona` must be derived from `activePersonas[0] === personaId`, never hardcoded to `'technical'`** (except the documented no-`session_id` contract-test fallback in `invite-agent/route.ts`) — a recruiter can reorder or deselect personas, so whichever one is actually first in the active panel is the one that should ask for the candidate's introduction.
- A persona switch must always pass `session_id` and `fromPersona` to `/api/invite-agent`, or the `handoff_log` write and the hand-off greeting variant are silently skipped — the new persona still starts, but re-introduces itself and may repeat questions.
- `formatTranscriptForHandoff` truncates to the last 40 turns / 6000 chars — a very long pre-switch conversation loses its earliest turns from the next persona's context, by design (not a bug to "fix" by raising the cap without reconsidering prompt-size cost).
- Feedback-report generation must never fail outright: `buildFeedbackReport` always falls back to the deterministic heuristic builder on missing `NEXT_LLM_API_KEY`/`NEXT_LLM_URL` or any LLM error. If you add a new failure path in `lib/report.ts`, keep it inside the existing `try/catch` so a broken LLM call still degrades to `source: 'heuristic'` rather than surfacing an error to the candidate.
- `lib/report.ts` imports `ai`/`@ai-sdk/openai` and is server-only — importing it from a client component breaks the build. Import `ReportTranscriptTurn`/`FeedbackReport` from `types/conversation.ts` instead.
- The countdown's zero-crossing must fire exactly once per persona — `ConversationComponent` guards this with a ref, not just a state comparison, because a `setInterval` tick can re-run after `remainingSeconds` is already `0` but before the switch/end call resolves. Removing the guard risks a double `handleSwitchPersona`/`handleEndConversation` call.
- The countdown is paused while `isSwitchingPersona` is true. If a future change starts the interval before that guard, the clock keeps ticking during the stop/start network round-trip and can trigger a second switch before the first one finishes.
- `sendRecruiterReportEmail` is only fired once per session, gated by a `SELECT` for an existing report row *before* the upsert in `app/api/session/[id]/report/route.ts`. If that gate is removed or reordered after the upsert, a retried/regenerated report will re-send the recruiter email.
- **The zero-crossing effect in `ConversationComponent.tsx` must depend on `[remainingSeconds]` alone — not on `currentPersona`, `handleSwitchPersona`, or `handleEndConversation`.** The sibling effect that resets the countdown for a new persona clears `hasTriggeredZeroRef.current` *synchronously* the instant `currentPersona` changes, but its own `setRemainingSeconds(...)` call only takes effect on the next render. If the zero-crossing effect also re-runs on that same `currentPersona` change (directly, or transitively via `handleSwitchPersona`/`handleEndConversation` identity changing whenever `currentPersona` does), it fires again in that same commit — seeing the just-cleared guard alongside the still-stale previous persona's `remainingSeconds === 0` — and skips straight to the persona *after* the one just switched to (e.g. technical → product → behavioral with product's conversation never happening). The fix is "latest ref" mirrors for `activePersonas`/`currentPersona`/the two handlers, read inside the effect without being listed as dependencies, so only an actual change in `remainingSeconds` can re-trigger it.
- The candidate interview link is one-time-use: `GET /api/session/[id]` reports `completed: true` once a `reports` row exists, and `InterviewSession.tsx` blocks a second `mic-check` attempt on that signal. There is no separate "used" column — don't add one; the existing 1:1 `reports.sessionId` primary key is the source of truth. The "Done" button on the report screen (`InterviewSession.handleReportDone`) does not reset back to `mic-check` — it attempts `window.close()` and falls back to a "you may close this tab" stage, since `window.close()` only succeeds on script-opened tabs and can't be relied on for a directly-navigated interview link.

## Debrief Pitfalls

- **`handleEndConversation`'s RTM/`agoraData` teardown is deliberately deferred, not skipped.** Unlike a plain "end the call" flow, it only logs out RTM and nulls `agoraData` immediately in the no-session/empty-transcript early-return branch — otherwise teardown waits for `handleSkipDebrief` or `handleEndDebrief`, after the candidate has chosen whether to take the debrief. If you touch `handleEndConversation`, keep the RTC/RTM connection alive through the `debrief-offer` stage; tearing it down early breaks `handleTalkToPanel`'s ability to start the debrief agent on the same channel.
- **`hiringScore` must never reach the debrief prompt.** This is enforced at the type level, not just by convention: `DebriefReportInput` (`lib/personas.ts`) and `DebriefReportPayload` (`types/conversation.ts`) both structurally omit `hiringScore`, and `handleTalkToPanel` builds the payload by explicitly picking `{ overallSummary, focusAreaCoverage, personas }` off the `report` state rather than spreading it. If you add a new recruiter-only field to `FeedbackReport`, add it to the picked fields only if it's meant to be candidate-visible — the default should be to leave it out of `DebriefReportPayload`.
- The debrief has no server-enforced time limit — only `DebriefCall.tsx`'s client-side 4-minute `SAFETY_CAP_MS` `setTimeout` calls `onEndDebrief`. If the candidate's tab is killed or loses connection before that fires, the debrief agent session eventually idles out via `idleTimeout: 30` on the Agora session config (same as any other agent session), not via this timer.
- `DebriefCall.tsx` intentionally does not reuse `QuickstartTranscriptPanel.tsx` — that panel renders persona-switch dividers from `personaTimeline`, which doesn't exist for a debrief. It has its own minimal inline transcript panel built from the `PersonaId`-free helpers in `lib/conversation.ts` (`normalizeTranscript`, `getMessageList`, `getCurrentInProgressMessage`). Don't thread a synthetic `PersonaId` through the debrief just to reuse the persona-panel components — see the plan rationale in [persona_handoff.md](L2/persona_handoff.md).

## Frontend Lifecycle Pitfalls

- Initializing toolkit before `joinSuccess` often causes missing subscriptions.
- Tying mic track creation directly to mute state can break visualizer audio graph.
- Failing to teardown RTM client on session end leaks subscriptions and stale events.

## Docs/Process Pitfalls

- Changing `components/` or `app/api/` without syncing README/GUIDE/TEXT_STREAMING/AGENTS leads to stale operator guidance.
- Updating workflows/contracts without updating `docs/ai/L1` and L0 `Last Reviewed` breaks progressive disclosure trust.
- Base recipe contracts also require `docs/ai/RECIPE.md` updates when extension points, invariants, or stable APIs change.

## Fast Triage Checklist

1. Run `agora project doctor --deep`.
2. Verify token route still uses `buildTokenWithRtm`.
3. Check `uid="0"` remap path.
4. Check `isReady` guard and hook ownership constraints.
5. Inspect connection issues panel for RTM/SAL/agent error signals.

## Frequent Regression Patterns

- Refactoring token route and accidentally removing RTM capability.
- Simplifying transcript list logic and unintentionally dropping interrupted turns.
- Moving toolkit init into mount-only effect and reintroducing StrictMode double-init.
- Replacing `useRef` RTC client storage with recreated client object per render.

## Symptom-to-File Debug Guide

| Symptom | First Files to Inspect |
| --- | --- |
| RTM login fails | `app/api/generate-agora-token/route.ts`, `components/InterviewSession.tsx` |
| Agent starts but no transcript | `components/ConversationComponent.tsx`, `lib/conversation.ts` |
| Conversation hangs on end | `components/InterviewSession.tsx`, `app/api/stop-conversation/route.ts` |
| Metrics panel empty | `components/ConversationComponent.tsx`, `components/QuickstartPipelineMetrics.tsx` |
| Persona switch fails or new persona repeats questions | `components/PersonaSwitcher.tsx`, `components/InterviewSession.tsx`, `app/api/invite-agent/route.ts`, [persona_handoff.md](L2/persona_handoff.md) |
| Feedback report missing or stuck loading | `app/api/session/[id]/report/route.ts`, `lib/report.ts`, `components/InterviewReport.tsx` |
| Panel doesn't auto-switch or auto-end on timeout | `components/ConversationComponent.tsx`, `components/InterviewSession.tsx` (`personaDurationsSeconds` conversion) |
| Recruiter never receives report email | `lib/mailer.ts`, `app/api/session/[id]/report/route.ts`, `EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` in `.env.local` |
| Auto-switch skips a persona (jumps two ahead) | `components/ConversationComponent.tsx` zero-crossing effect's dependency array — see stale-closure gotcha above |
| Interview link reusable after completion / candidate name missing from report | `app/api/session/[id]/route.ts` (`completed` flag), `components/MicCheck.tsx`, `components/InterviewSession.tsx`, `lib/report.ts` |
| React error #130 ("Element type is invalid") right after mic-check, only in production/Vercel builds | `components/InterviewSession.tsx` (`dynamic()` loader shapes), `components/AgoraProvider.tsx` — see `next/dynamic()` loader-shape gotcha above |
| Debrief never offered, or connection dies before the offer appears | `components/InterviewSession.tsx` (`handleEndConversation`'s deferred RTM teardown), `debrief-offer` stage render branch |
| Debrief agent won't start / "Failed to start debrief" | `components/InterviewSession.tsx` (`handleTalkToPanel`), `app/api/invite-agent/route.ts` (`debrief`/`debriefReport` branch), `lib/personas.ts` (`buildDebriefSystemPrompt`) |
| Debrief mentions a score or hire/no-hire verdict | `lib/personas.ts` (`buildDebriefSystemPrompt`'s Rules section), `DebriefReportInput`/`DebriefReportPayload` shape — confirm `hiringScore` isn't leaking through a new field |
| Persona asks about topics outside its assigned focus areas, or wrong persona opens with the introduction | `lib/personas.ts` (`buildPersonaSystemPrompt`'s hard-constraint focus-areas section, `isFirstActivePersona` intro branch), `app/api/invite-agent/route.ts` (`personaFocusAreas[personaId]`/`isFirstActivePersona` lookup), `components/SetupScreen.tsx` (per-persona focus-area input) |

## Sandbox and Local Dev Caveats

- `pnpm run dev` can fail in restricted environments due to port/process limits.
- Route contract checks are better suited for restricted CI/sandbox contexts.
- Some failures are environment-binding issues, not code regressions.

## Pre-merge Gotcha Checklist

- Confirm no manual `leave()` or `close()` lifecycle calls were introduced.
- Confirm transcript mapping still remaps sentinel local UID.
- Confirm token renewal still returns both RTC and RTM tokens.
- Confirm docs were updated when workflow/interface behavior changed.

## Incident Learning Notes

- Connection issue deduplication intentionally uses a small time window to avoid noisy cascades.
- Invite failures are intentionally non-fatal to allow UI fallback state visibility.
- Raw RTM fallback parsing exists because higher-level hooks may miss some signaling payloads in edge conditions.

## Related Deep Dives

- [conversation_lifecycle.md](L2/conversation_lifecycle.md) — Start/switch/stop race and lifecycle ownership details.
- [transcript_pipeline.md](L2/transcript_pipeline.md) — Transcript edge cases and failure surfaces.
- [invite_agent_config.md](L2/invite_agent_config.md) — Agent construction and per-persona config failure modes.
- [persona_handoff.md](L2/persona_handoff.md) — Persona switch sequence and context hand-off.
