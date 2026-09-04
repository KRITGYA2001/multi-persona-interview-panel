> **When to Read This:** Load this when changing how the panel auto-advances between personas mid-call, how hand-off context is carried to the next persona, or how transcript turns get attributed to a persona.

# Persona Hand-off

## Overview

Multi Persona runs one interviewer persona at a time. Each persona gets a recruiter-configured time budget (set at setup, in minutes — [`SetupScreen.tsx`](../../../../components/SetupScreen.tsx)); the panel switches to the next panelist automatically when that persona's countdown hits zero, and the interview ends automatically when the last persona's time also expires. The candidate can still end early at any time via the "End conversation" button. [`PersonaSwitcher.tsx`](../../../../components/PersonaSwitcher.tsx) is a **read-only** status/countdown display — it no longer drives switching; the candidate cannot click to switch personas. A switch is **not** a second agent joining the call — it is a stop-and-restart of the single Agora agent session, on the same fixed RTC UID, with the prior conversation summarized into the new persona's system prompt.

## Why Stop-and-Restart, Not Concurrent Agents

Only one panelist is ever meant to be speaking at a time, so the agent UID never varies by persona: [`app/api/invite-agent/route.ts`](../../../../app/api/invite-agent/route.ts) always calls `createSession` with `agentUid: String(DEFAULT_AGENT_UID)` regardless of which persona is starting. [`ConversationComponent.tsx`](../../../../components/ConversationComponent.tsx) hardcodes the same constant (`const agentUID = String(DEFAULT_AGENT_UID)`) for `user-joined`/`user-left` presence detection. Because the UID is fixed, a persona switch needs no changes to RTC join state, presence detection, or transcript speaker-side rendering — it is purely: stop the current agent session, start a new one for the new persona on the same channel/UID.

Since the agent UID no longer distinguishes *which* persona is speaking, transcript turns are instead tagged by **when** they were spoken, via a client-side `personaTimeline`.

## The Timer-Driven Switch Sequence

1. `ConversationComponent` tracks `remainingSeconds` for the active persona, seeded from the `personaDurationsSeconds` prop (recruiter-configured minutes, converted to seconds by [`InterviewSession.tsx`](../../../../components/InterviewSession.tsx), falling back to 5 minutes for any persona missing a duration — e.g. a session created before this field existed) and counted down by a `setInterval` tick, paused while `isSwitchingPersona` is true.
2. When `remainingSeconds` reaches `0` (guarded by a ref so it fires exactly once per persona), `ConversationComponent` looks up the next persona in `activePersonas`: if one exists, it calls its own internal `handleSwitchPersona(next)` — the same function a manual switch used to call; if the expiring persona was the last one, it calls `handleEndConversation()` instead, ending the interview automatically.
3. `handleSwitchPersona` builds the hand-off transcript: `formatTranscriptForHandoff(messageList, personaTimeline, localUID)` in [`lib/conversation.ts`](../../../../lib/conversation.ts) — formats the most recent 40 turns (capped to 6000 chars) as `"[Label]: text"` lines, tagging each completed turn's speaker via `getPersonaAtTimestamp`.
4. `ConversationComponent` calls `onSwitchPersona(next, transcriptText)`, which is `InterviewSession.handleSwitchPersona`.
5. `InterviewSession`:
   - `POST /api/stop-conversation` with the current `agoraData.agentId` (logged, non-fatal if it fails).
   - `POST /api/invite-agent` with `{ requester_id: agoraData.uid, channel_name: agoraData.channel, persona: next, session_id: session.id, priorContext: transcriptText, fromPersona: currentPersona }`.
   - On success, updates `agoraData.agentId` and `currentPersona` state.
6. `ConversationComponent` (on success) appends `{ persona: next, since: Date.now() }` to its local `personaTimeline` state, and a separate effect resets `remainingSeconds` to the new persona's budget and clears the zero-crossing guard.
7. On failure at any step, `isSwitchingPersona`/`switchError` surface an inline error in the (read-only) `PersonaSwitcher` — the candidate stays on the call with the previous persona still notionally active (no automatic retry).

The candidate's "End conversation" control (in `QuickstartConversationLayout`) calls the same `handleEndConversation` used by the auto-end-on-last-persona path, so both the timed and manual end routes converge on one code path — including the report-email trigger described in [`06_interfaces.md`](../06_interfaces.md). The RTC connection, RTM subscription, and `ConversationComponent` mount are untouched by a switch — only the agent session and local persona/timeline/timer state change.

## Context Hand-off Into the New Persona's Prompt

`app/api/invite-agent/route.ts` receives `priorContext` and `fromPersona` on `ClientStartRequest`. If `priorContext` is present and `GROQ_API_KEY` is configured, the route first calls `groqRespond()` ([`lib/groq.ts`](../../../../lib/groq.ts)) with an instruction to summarize the raw transcript in under 200 words, preserving concrete facts the candidate stated and noting which topics are already covered. If Groq returns a summary, that summary is used as `contextForPrompt`; otherwise (no `GROQ_API_KEY`, or the Groq call fails) `contextForPrompt` falls back to the raw `priorContext` transcript unchanged — the pre-Groq behavior. `contextForPrompt` is then passed into `buildPersonaSystemPrompt(personaId, roleTitle, focusAreas, contextSoFar)` in [`lib/personas.ts`](../../../../lib/personas.ts). When `contextSoFar` is present, the built prompt appends a "# Conversation So Far" section instructing the new persona not to repeat questions already asked and not to re-introduce the panel formally. `buildPersonaGreeting(personaId, roleTitle, isHandoff)` also switches to a shorter hand-off greeting (e.g. *"Thanks — I'm the {label} panelist, and I'll take it from here."*) instead of the cold-open greeting used for the very first persona.

This is a **prompt-injection hand-off**: the receiving persona's own LLM (gpt-4o-mini via the Agora-managed pipeline) reads and reacts to the (optionally Groq-summarized) transcript text directly. The Groq summarization step is a best-effort pre-processing pass on the hand-off text — it is not a separate call into the conversation pipeline, cannot block a switch (the fallback is always the untouched raw transcript), and adds no new credential requirement (see [08_security.md](../08_security.md) for `GROQ_API_KEY` handling).

## `handoff_log` Write

After a successful `session.start()` in `invite-agent/route.ts`, if both `session_id` and `fromPersona` were present in the request (i.e. this is an actual switch, not the initial persona start), the route does a best-effort, non-fatal read-modify-write of `candidateContext.context.handoff_log` for that session: append `{ from: fromPersona, to: personaId, at: new Date().toISOString() }`. This write is wrapped so a DB failure never blocks the agent session from starting — the candidate's call is never interrupted by a logging failure. `handoff_log` is scaffolded as `[]` at session creation in `app/api/session/route.ts` and is not currently read back by any route; it exists as an audit trail for future recruiter-facing tooling.

## Transcript Attribution Without a Per-Persona UID

Because every persona speaks as the same `agentUID`, both the live transcript panel and the end-of-call report need another way to know which persona said what:

- **Live panel**: `ConversationComponent` passes `personaTimeline` down to [`QuickstartTranscriptPanel.tsx`](../../../../components/QuickstartTranscriptPanel.tsx), which renders a divider between turns whose `createdAt` crosses a timeline boundary.
- **End-of-call report**: `ConversationComponent.handleEndConversation` maps `messageList` into `ReportTranscriptTurn[]`, tagging each turn's `persona` via `getPersonaAtTimestamp(personaTimeline, message.createdAt)` and its `speaker` as `'candidate'` or `'panelist'` by comparing `message.uid` to the local RTC UID. This tagged transcript is what `InterviewSession.handleEndConversation` posts to `/api/session/[id]/report` — see [`persona_handoff.md`](persona_handoff.md) callers in `lib/report.ts` for how the report groups feedback per persona.

## Not a Persona Switch: the Post-Interview Debrief

After the last persona's segment ends and a feedback report is generated, the candidate can optionally start a debrief — a Q&A with the panel about their own report. This reuses the same low-level mechanism described above (stop the current agent, invite a new one on the same fixed `agentUid`/channel — `app/api/invite-agent/route.ts` with `debrief: true` instead of a `persona` field), but it is **not** a persona switch: there is no `PersonaId`, no entry in `activePersonas`, no `personaTimeline` update, and no countdown. It is implemented as its own component, [`DebriefCall.tsx`](../../../../components/DebriefCall.tsx), rather than a fourth value threaded through `ConversationComponent`'s persona-coupled machinery — see [07_gotchas.md](../07_gotchas.md) for why. The debrief's prompt is built from the just-generated `FeedbackReport` (minus `hiringScore`, which never reaches the candidate) via `buildDebriefSystemPrompt`/`buildDebriefGreeting` in `lib/personas.ts`, not from `buildPersonaSystemPrompt`/`buildPersonaGreeting`. Full flow: [02_architecture.md](../02_architecture.md)'s End Sequence.

## Related Deep Dives

- [invite_agent_config.md](invite_agent_config.md) — Full agent builder chain, including how `priorContext`/`fromPersona`/`persona` are consumed.
- [conversation_lifecycle.md](conversation_lifecycle.md) — Full start/switch/end sequence in context.
- [Back to Interfaces](../06_interfaces.md)
