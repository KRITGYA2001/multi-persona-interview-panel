> **When to Read This:** Load this document when you are changing a persona's prompt/voice, VAD behavior, model selection, wiring a bring-your-own-key (BYOK) provider, or the persona-switch/hand-off request fields.

# Invite Agent Config

## Where It Lives

All of the managed agent configuration is built in `app/api/invite-agent/route.ts`. The route receives a `ClientStartRequest` body — `{ requester_id, channel_name, session_id?, persona?, priorContext?, fromPersona?, debrief?, debriefReport? }` — from `InterviewSession.tsx` (on initial call start, on every mid-call persona switch, and once more for the optional post-interview debrief), constructs an `Agent` from `agora-agents`, and starts a session bound to the requester's RTC channel.

## Request Fields

| Field           | Required | Purpose                                                                                   |
| --------------- | :------: | ------------------------------------------------------------------------------------------ |
| `requester_id`  |    ✅    | The candidate's RTC UID, used for `remoteUids`.                                            |
| `channel_name`  |    ✅    | The RTC channel the agent joins.                                                            |
| `persona`       |          | `PersonaId` to start as (`'technical' \| 'product' \| 'behavioral'`). Defaults to `'technical'` if omitted. |
| `session_id`    |          | Interview session ID — used to load `roleTitle`/`personaFocusAreas[persona]`/`personaDurations[persona]` from Postgres as the source of truth, to derive `isFirstActivePersona` (`activePersonas[0] === persona`), and to scope the `handoff_log` write. |
| `priorContext`  |          | Formatted transcript-so-far (see [persona_handoff.md](persona_handoff.md)), passed only when this call is a mid-call persona switch. |
| `fromPersona`   |          | The persona the candidate was just switched away from, for `handoff_log` logging. Only meaningful alongside `session_id`. |
| `debrief`       |          | `true` to start the post-interview debrief agent instead of a persona. Mutually exclusive with `persona`/`priorContext`/`fromPersona`; `400` if `debrief: true` is sent without `debriefReport`. |
| `debriefReport` |          | A `DebriefReportPayload` (the just-generated `FeedbackReport` minus `hiringScore` — see [08_security.md](../08_security.md)), required when `debrief: true`. Used to build the debrief system prompt instead of `buildPersonaSystemPrompt`. |

Role/focus-area context is loaded from Postgres by `session_id` rather than trusted from the client, so the spoken system prompt can never drift from what the recruiter configured in `SetupScreen`. The debrief path is the one branch that does *not* build its prompt from `PERSONA_DEFINITIONS`/Postgres role data — it builds entirely from the client-supplied `debriefReport`, since by that point the interview (and its role/focus-area context) is already over.

`focusAreas` looked up per request is `session.personaFocusAreas[personaId]` (per-panelist, set on `SetupScreen`) — **not** the flat, panel-wide `session.focusAreas` column, which is kept only as a derived union for other consumers (`lib/report.ts`, `candidateContext`). See [persona_handoff.md](persona_handoff.md#per-persona-focus-areas-and-the-first-persona-introduction) for the full per-persona focus-area and first-persona-intro design.

## Persona Definitions

Each persona's `label`, `focus`, `voiceId`, and `behaviorSignature` are defined in [`lib/personas.ts`](../../../../lib/personas.ts) as `PERSONA_DEFINITIONS`. `buildPersonaSystemPrompt(personaId, roleTitle, focusAreas, contextSoFar?, durationMinutes?, isFirstActivePersona?)` builds the system prompt for the persona being started: `focusAreas` is now a hard constraint — the persona is instructed to never ask about anything outside its own assigned list — and `isFirstActivePersona` (`session.activePersonas[0] === personaId`, computed in the route) determines whether the prompt should skip re-asking for the candidate's introduction. When `contextSoFar` is present (a mid-call switch) it appends a "# Conversation So Far" section. `buildPersonaGreeting(personaId, roleTitle, isHandoff?, fromPersonaId?, isFirstActivePersona?)` returns a cold-open greeting (with an introduction ask only when `isFirstActivePersona` is true), a plain "let's get started" cold-open otherwise, or a shorter hand-off greeting when `isHandoff` is true.

When the request has `debrief: true`, the route skips `PERSONA_DEFINITIONS`/`buildPersonaSystemPrompt`/`buildPersonaGreeting` entirely and instead calls `buildDebriefSystemPrompt(roleTitle, debriefReport)`/`buildDebriefGreeting()` and uses the fixed `DEBRIEF_VOICE_ID` in place of `persona.voiceId` — there is no `PersonaId` for the debrief, so it isn't a `PERSONA_DEFINITIONS` entry.

## The Agent Builder Chain

`AgoraClient` is constructed first — it carries the region and credentials for all API calls, and is passed directly into the `Agent` constructor (not into `createSession`).

```ts
const client = new AgoraClient({ area: Area.US, appId, appCertificate });

const persona = getPersonaDefinition(personaId);
const systemPrompt = buildPersonaSystemPrompt(personaId, roleTitle, focusAreas, priorContext, durationMinutes, isFirstActivePersona);
const greeting = buildPersonaGreeting(personaId, roleTitle, Boolean(priorContext), fromPersona, isFirstActivePersona);

const agent = new Agent(client, {
  name: `conversation-${Date.now()}-${randomHex}`,
  instructions: systemPrompt,
  greeting,
  failureMessage: 'Please wait a moment.',
  maxHistory: 50,
  turnDetection: {
    config: {
      speech_threshold: 0.5,
      start_of_speech: { /* VAD on-start params */ },
      end_of_speech:   { /* VAD on-end params */ },
    },
  },
  advancedFeatures: { enable_rtm: true, enable_tools: true },
  parameters: {
    audio_scenario: 'chorus',
    data_channel: 'rtm',
    enable_error_message: true,
    enable_metrics: true,
  },
})
  .withStt(new DeepgramSTT({ model: 'nova-3', language: 'en' }))
  .withLlm(new OpenAI({
    model: 'gpt-4o-mini',
    greetingMessage: greeting,
    failureMessage: 'Please wait a moment.',
    maxHistory: 15,
    params: { max_tokens: 1024, temperature: 0.7, top_p: 0.95 },
  }))
  .withTts(new MiniMaxTTS({
    model: 'speech_2_6_turbo',
    voiceId: persona.voiceId,
  }));
```

The TTS voice is selected per persona via `persona.voiceId` (a MiniMax managed voice preset defined alongside each entry in `PERSONA_DEFINITIONS`), so each panelist sounds distinct.

## Session Options

`agent.createSession(options)` is a **single-argument call on the `agent` instance** — the client was already bound in the `Agent` constructor above, it is not passed again here. `session.start()` is called separately and returns the `agentId`.

```ts
const agentUid = String(DEFAULT_AGENT_UID); // always constant — see persona_handoff.md

const session = agent.createSession({
  channel: channel_name,
  agentUid,
  remoteUids: [requester_id],
  idleTimeout: 30,
  expiresIn: ExpiresIn.hours(1),
  debug: false,
});
const agentId = await session.start();
```

| Option        | Effect                                                                               |
| ------------- | ------------------------------------------------------------------------------------ |
| `channel`     | The RTC channel name the agent joins.                                                |
| `agentUid`    | Always `String(DEFAULT_AGENT_UID)`, regardless of persona — see [persona_handoff.md](persona_handoff.md) for why it never varies. |
| `remoteUids`  | Restricts the agent to the requester's UID — protects against cross-channel sniping. |
| `idleTimeout` | Seconds of silence before the session ends.                                          |
| `expiresIn`   | Hard ceiling on session length, mirrors the 1-hour RTC token.                        |
| `debug`       | Logs Agora REST API calls to the console when `true`.                                |

## `handoff_log` Write

After `session.start()` succeeds, if the request included both `session_id` and `fromPersona`, the route does a best-effort read-modify-write of `candidateContext.context.handoff_log` for that `session_id`, appending `{ from: fromPersona, to: personaId, at: new Date().toISOString() }`. This is wrapped so a DB error never fails the response — the candidate's agent session has already started successfully by this point. Full detail in [persona_handoff.md](persona_handoff.md).

## Editing Each Surface

### Change a persona's prompt or focus

Edit the relevant entry in `PERSONA_DEFINITIONS` in `lib/personas.ts`, and/or the shared prompt-building logic in `buildPersonaSystemPrompt`.

### Change a persona's greeting

Edit `buildPersonaGreeting` in `lib/personas.ts`.

### Change VAD behavior

Edit `turnDetection.config.start_of_speech` and `turnDetection.config.end_of_speech` in `app/api/invite-agent/route.ts`. Both blocks accept the new VAD param shape — do **not** revert to the deprecated `turnDetection.type: 'agora_vad'`.

### Swap the STT model

Replace the `DeepgramSTT` constructor. To use Deepgram with a BYOK key, set `NEXT_DEEPGRAM_API_KEY` and pass `apiKey: process.env.NEXT_DEEPGRAM_API_KEY` to the constructor.

### Swap the LLM

Replace `OpenAI` with another LLM class from `agora-agents`. For a custom URL, point the constructor at `process.env.NEXT_LLM_URL` and pass `apiKey: process.env.NEXT_LLM_API_KEY`. Note these are the same two env vars used by [`lib/report.ts`](../../../../lib/report.ts) for feedback-report generation — they are shared BYOK config, not route-specific.

### Swap the TTS or per-persona voices

Replace `MiniMaxTTS`, or edit `voiceId` per entry in `PERSONA_DEFINITIONS`. ElevenLabs is the common BYOK choice — use `NEXT_ELEVENLABS_API_KEY` and `NEXT_ELEVENLABS_VOICE_ID`. The commented BYOK example in the route shows the constructor shape.

### Change the debrief's prompt, greeting, or voice

Edit `buildDebriefSystemPrompt`/`buildDebriefGreeting`/`DEBRIEF_VOICE_ID` in `lib/personas.ts` — not `buildPersonaSystemPrompt`/`buildPersonaGreeting`, which the debrief path doesn't use. If you add a new field to the prompt's input, keep it out of `DebriefReportInput`/`DebriefReportPayload` unless it's meant to be candidate-visible; `hiringScore` is deliberately excluded (see [08_security.md](../08_security.md)).

## Response Contract

On success the route returns `AgentResponse`:

```json
{
  "agent_id": "string",
  "create_ts": 1700000000,
  "state": "RUNNING"
}
```

`agent_id` is what `InterviewSession` later passes to `/api/stop-conversation` — both on a persona switch (to stop the outgoing agent) and at call end.

## Verification

`scripts/verify-api-contracts.ts` mocks `Agent.prototype.createSession` and asserts:

- Missing `channel_name` or `requester_id` → `400`.
- Mocked success → `200` with `agent_id`, `create_ts`, `state`.
- `priorContext` is reflected in the constructed `instructions`.

After editing this file, run:

```bash
pnpm run verify:api
pnpm run typecheck
```

## Failure Modes

| Symptom                                                | Cause                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `400 channel_name and requester_id are required`       | Browser sent an empty body or wrong field names.               |
| `500 Agora credentials are not set`                    | `NEXT_AGORA_APP_CERTIFICATE` missing in env.                   |
| Agent joins but never speaks                           | TTS misconfigured (wrong `voiceId` or missing BYOK key).       |
| Agent state stuck on `IDLE`                            | `enable_rtm: true` missing or RTM client not subscribed yet.   |
| New persona repeats questions already asked            | `priorContext` not passed, or `session_id`/`fromPersona` missing on the switch request. |
| `400` on the debrief invite                             | `debrief: true` sent without `debriefReport`, or `debriefReport` still carries `hiringScore` (should be typed out — see [08_security.md](../08_security.md)). |
| `verify:api` fails on the route                        | New required field added without updating the harness.         |

## See Also

- [Back to Workflows](../05_workflows.md)
- [Back to Interfaces](../06_interfaces.md)
- [persona_handoff.md](persona_handoff.md)
- [Token Model](token_model.md)
