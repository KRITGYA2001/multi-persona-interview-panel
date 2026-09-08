> **When to Read This:** Load this when changing how a session starts, switches persona, renews, or stops, especially across `SetupScreen`, `MicCheck`, `InterviewSession`, `ConversationComponent`, and `app/api/*` routes.

# Conversation Lifecycle

## Overview

Multi Persona orchestrates one candidate session across five coupled systems:

- Next.js browser UI state (`SetupScreen` -> `MicCheck` -> `InterviewSession` -> `ConversationComponent`).
- Postgres session/report storage (`lib/db`).
- Agora RTC media transport.
- Agora RTM data transport.
- Agora managed agent backend lifecycle — one persona's agent session at a time.

The correctness target is single-init, predictable teardown, no leaked RTM/RTC resources, and a persona switch that never disturbs the underlying RTC/RTM connection.

## Detailed Start Sequence

1. Recruiter fills out `SetupScreen`, which `POST`s `/api/session` (creates `sessions` + scaffolds `candidateContext`) and produces the candidate link `/interview/[sessionId]`.
2. Candidate opens the link; `InterviewSession` fetches `GET /api/session/[id]` for `roleTitle`/`focusAreas`/`activePersonas`/`personaFocusAreas`, and starts on the `'mic-check'` stage, rendering `MicCheck`.
3. Once the candidate passes the mic check, `InterviewSession.startConversation()` calls `GET /api/generate-agora-token`.
4. In parallel:
   - `POST /api/invite-agent` starts the first persona's managed agent session (`persona` = first entry in `activePersonas`, `session_id` set, no `priorContext`/`fromPersona` on this initial call).
   - RTM client is created, logs in with token, subscribes to channel.
5. On success, `agoraData` + `rtmClient` + `currentPersona` are stored, `InterviewSession` transitions to `'conversation'`, and `ConversationComponent` mounts.
6. `useJoin` and `useLocalMicrophoneTrack` remain gated by `isReady` StrictMode guard.
7. After join success, `AgoraVoiceAI.init()` binds RTC+RTM engines and subscribes messages.
8. UI renders visualizer, transcript, metrics panels, and the `PersonaSwitcher` pill row.

## StrictMode Safety Contract

- `isReady` flips `true` only after the fake-unmount cycle finishes.
- First fake mount timer is synchronously cancelled; second real mount timer survives.
- This keeps join and track init single-run in development.

Breaking this guard causes duplicate client/track/toolkit initialization patterns that are hard to recover from.

## Token Renewal Flow

- Renewal callback receives actual joined RTC UID.
- Two renewal calls are made in parallel:
- RTC renewal for current joined UID.
- RTM renewal for original login UID.
- Both target same channel.
- Result returns `rtcToken` + `rtmToken` to caller.

## Mid-Call Persona Switch

The RTC/RTM connection and `ConversationComponent` mount are never torn down for a switch — only the agent session and persona state change. Switching is **timer-driven only** — there is no candidate-facing switch control; `PersonaSwitcher` is a read-only countdown display. Full detail (including why `agentUid` stays fixed and how transcript attribution works without a per-persona UID) is in [persona_handoff.md](persona_handoff.md); summary:

1. `ConversationComponent`'s per-persona countdown (`remainingSeconds`, seeded from `personaDurationsSeconds`) reaches zero -> `ConversationComponent` internally calls `handleSwitchPersona(next)` (or `handleEndConversation()` if the expiring persona was the last one).
2. `ConversationComponent` formats the hand-off transcript via `formatTranscriptForHandoff` and calls `onSwitchPersona(next, transcriptText)`, which is `InterviewSession.handleSwitchPersona`.
3. `InterviewSession` calls `POST /api/stop-conversation` for the current `agentId` (non-fatal on failure), then `POST /api/invite-agent` with `persona: next`, `priorContext: transcriptText`, `fromPersona: currentPersona`.
4. On success, `InterviewSession` updates `agoraData.agentId`/`currentPersona`; `ConversationComponent` appends to its local `personaTimeline` and resets the countdown for the new persona.
5. On failure, `switchError` surfaces inline in `PersonaSwitcher` — the candidate remains on the call with the previous persona still active (no automatic retry).

## Teardown, Debrief & Report Sequence

1. The last persona's countdown reaches zero (or the candidate clicks "End conversation" early); if `agentId` exists, `InterviewSession` calls `POST /api/stop-conversation`. Stop route calls `client.stopAgent(agent_id)` and treats already-stopping states as success.
2. `ConversationComponent.handleEndConversation` builds a persona-tagged `ReportTranscriptTurn[]` from `messageList` (via `getPersonaAtTimestamp`) and calls `onEndConversation(transcript)`.
3. `InterviewSession.handleEndConversation`: if there's no session or an empty transcript, it logs out RTM/nulls `agoraData` immediately and returns to `'mic-check'`. Otherwise **RTM/`agoraData` teardown is deferred** (not skipped) — the connection needs to stay alive for a possible debrief — and the UI transitions to `'debrief-offer'` while `POST /api/session/[id]/report` generates and persists a `FeedbackReport`.
4. The candidate is offered "Talk to the panel about it" / "Skip to my written report":
   - **Skip** (`handleSkipDebrief`): logs out RTM, nulls `agoraData`, transitions to `'report'` — this is the teardown point equivalent to the pre-debrief flow.
   - **Talk** (`handleTalkToPanel`): `POST /api/invite-agent` with `debrief: true` and a `DebriefReportPayload` (built from `report`, excluding `hiringScore`); on success transitions to `'debrief'` and mounts `DebriefCall`, which joins/converses like `ConversationComponent` but with no persona timeline or countdown. A manual "I'm Done" button or a silent safety-cap timer both call `handleEndDebrief`, which stops the debrief agent, logs out RTM, nulls `agoraData`, and transitions to `'report'`.
5. `InterviewReport` renders with the result (or a heuristic-fallback/error state) regardless of which debrief path was taken. A report-generation failure surfaces `reportError` rather than blocking the flow.
6. `agora-rtc-react` hook ownership handles leave/unpublish/track cleanup after unmount; the toolkit cleanup path unsubscribes and destroys the `AgoraVoiceAI` singleton for whichever call (persona or debrief) was last active.
7. `InterviewReport`'s "Done" action does **not** reset back to `'mic-check'` — the interview link is one-time-use (see [07_gotchas.md](../07_gotchas.md)); it attempts `window.close()` and falls back to a "you may close this tab" stage.

## Failure Modes and Recovery

- Invite failure is non-fatal to render path: UI still mounts and shows warning.
- RTM bootstrap failure is fatal to start path because transcript pipeline depends on it.
- Stop failures are logged, but UI teardown still continues.
- Persona-switch failures never end the call — `switchError` is inline and recoverable; the candidate can retry or continue with the current persona.
- Report-generation failures never block teardown or hide the candidate's completed call — `reportError` renders in place of the report, agent/RTC/RTM cleanup is already done.
- A failed debrief invite (`handleTalkToPanel`) does not strand the candidate on a dead connection — RTM/`agoraData` are still live at that point (teardown was deferred), so the candidate can fall back to "Skip to my written report."

## Cross-File Dependencies

- `components/SetupScreen.tsx`: recruiter session creation.
- `components/MicCheck.tsx`: pre-join mic gate.
- `components/InterviewSession.tsx`: bootstrap orchestration, persona-switch delegation, report generation, renewal callback.
- `components/ConversationComponent.tsx`: join/toolkit/mic runtime behavior, countdown/auto-switch/auto-end, `personaTimeline`, hand-off transcript formatting.
- `components/PersonaSwitcher.tsx`: read-only status/countdown display.
- `components/DebriefCall.tsx`: post-interview debrief call UI — same join/mic/`AgoraVoiceAI` pattern as `ConversationComponent`, no persona timeline or countdown.
- `components/InterviewReport.tsx`: report UI.
- `app/api/generate-agora-token/route.ts`: RTM-capable token minting.
- `app/api/invite-agent/route.ts`: agent pipeline config, per-persona prompt/greeting/voice, `handoff_log` write, debrief agent start (`debrief`/`debriefReport`).
- `app/api/stop-conversation/route.ts`: idempotent stop semantics.
- `app/api/session/route.ts`, `app/api/session/[id]/route.ts`: session creation/load.
- `app/api/session/[id]/report/route.ts`: report generation/persistence.
- `lib/personas.ts`, `lib/conversation.ts`, `lib/report.ts`: shared logic behind the above.

## Related Deep Dives

- [persona_handoff.md](persona_handoff.md) — Full persona-switch mechanism.
- [invite_agent_config.md](invite_agent_config.md) — Agent construction detail.
- [transcript_pipeline.md](transcript_pipeline.md) — Transcript normalization and attribution.
