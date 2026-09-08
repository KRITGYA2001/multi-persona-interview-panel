# 05 Workflows

> Repeatable task recipes for common quickstart changes and validation loops.

## Run Locally

1. `pnpm install`
2. `agora login`
3. `agora project use <your-project>`
4. `agora project env write .env.local`
5. `pnpm run doctor`
6. `pnpm run dev`

If start fails, run `agora project doctor --deep`.

## Change Agent Behavior

Target files: `app/api/invite-agent/route.ts` and `lib/personas.ts`.

Typical edits:

- Per-persona system prompt/focus (`buildPersonaSystemPrompt`, `PERSONA_DEFINITIONS` in `lib/personas.ts`).
- Per-persona greeting (`buildPersonaGreeting` in `lib/personas.ts`).
- Fixed agent UID (`DEFAULT_AGENT_UID` in `lib/agora.ts`) — never make this vary per persona, see [persona_handoff.md](L2/persona_handoff.md).
- VAD (`turnDetection.config.*` in `invite-agent/route.ts`).
- STT/LLM/TTS model/provider blocks, and per-persona `voiceId`.

See [invite_agent_config.md](L2/invite_agent_config.md) for the full builder chain.

Validation path:

1. `pnpm run lint`
2. `pnpm run typecheck`
3. `pnpm run verify:api`
4. `pnpm run build`

## Add a New Persona

1. Add a new entry to `PERSONA_DEFINITIONS` in `lib/personas.ts` (`id`, `label`, `focus`, `voiceId`, `behaviorSignature`).
2. Extend `buildPersonaSystemPrompt`/`buildPersonaGreeting` if the new persona needs prompt logic beyond the shared template.
3. Add the new `PersonaId` to the `activePersonas` default/options surfaced in `SetupScreen.tsx`.
4. No DB migration needed — `activePersonas` is a jsonb column on `sessions`.
5. Run `pnpm run typecheck` (the `PersonaId` union will surface any exhaustiveness gaps) and manually verify a switch to the new persona in the dev server.

## Change Token or Session Bootstrap

Token behavior:

- Edit `app/api/generate-agora-token/route.ts`.
- Preserve RTM-capable token generation.

Bootstrap behavior:

- Edit `components/InterviewSession.tsx`.
- Keep invite + RTM setup parallelized before conversation mount.
- Session/role/persona data loads from `GET /api/session/[id]` before `startConversation()` runs.

## Change Feedback Report

1. Update the heuristic builder or the LLM prompt/schema in `lib/report.ts`. Note the builder tries Groq first (when `GROQ_API_KEY` is set, via `groqRespond()` in `lib/groq.ts`), then falls through to the `NEXT_LLM_API_KEY`/`NEXT_LLM_URL` `@ai-sdk/openai` path, then the heuristic builder — both LLM stages share `REPORT_SYSTEM_PROMPT`/`buildReportUserPrompt`/`tryParseReportJson` so prompt/schema changes apply to both.
2. Keep any new LLM failure path (Groq or `@ai-sdk/openai`) inside the existing `try/catch`/null-check so it still falls back down the chain to `source: 'heuristic'`.
3. Update `FeedbackReport`/`FeedbackReportPersonaSection` in `types/conversation.ts` if the shape changes, and `components/InterviewReport.tsx` to render new fields, and `lib/mailer.ts`'s `renderReportText`/`renderReportHtml` so the recruiter email stays in sync.
4. Run `pnpm run typecheck` and `pnpm run verify:api` (no live LLM key needed — the heuristic path is what CI exercises).

## Change Panel Timing / Recruiter Email Delivery

1. Recruiter sets each active persona's minute budget in `SetupScreen.tsx`; it's validated/defaulted server-side in `app/api/session/route.ts` (`normalizePersonaDurations`) and stored as `personaDurations` (minutes) on the `sessions` row. Recruiter also sets each active persona's focus areas in the same panel (mirrored UI), normalized server-side (`normalizePersonaFocusAreas`) and stored as `personaFocusAreas` on the `sessions` row — see [persona_handoff.md](L2/persona_handoff.md#per-persona-focus-areas-and-the-first-persona-introduction).
2. `InterviewSession.tsx` converts `personaDurations` (minutes) to `personaDurationsSeconds` and passes it into `ConversationComponent`, which owns the countdown/auto-switch/auto-end logic — see [persona_handoff.md](L2/persona_handoff.md) for the full timer-driven sequence.
3. `PersonaSwitcher.tsx` is a read-only status display (countdown badge on the active persona) — it has no click/switch semantics; don't reintroduce an `onSwitch` prop without re-checking this workflow.
4. The recruiter's email address is captured in `SetupScreen.tsx`, validated in `app/api/session/route.ts`, and stored as `recruiterEmail` on the `sessions` row — never returned by `GET /api/session/[id]` (server-only).
5. `app/api/session/[id]/report/route.ts` calls `sendRecruiterReportEmail` (`lib/mailer.ts`) on the first report generated for a session; both the timer-driven auto-end and the manual "End conversation" button converge on this same route, so no separate email trigger is needed for either path.
6. If you change `FeedbackReport`'s shape, update `lib/mailer.ts` per the "Change Feedback Report" workflow above.
7. Run `pnpm run typecheck`, `pnpm run verify:api`, and manually verify a real timed call end-to-end (voice calls can't be automated — see Ship-Readiness Workflow).

## Change the Post-Interview Debrief

Target files: `components/DebriefCall.tsx`, `components/InterviewSession.tsx`, `app/api/invite-agent/route.ts`, `lib/personas.ts`.

Typical edits:

- Debrief prompt/greeting/voice: `buildDebriefSystemPrompt`/`buildDebriefGreeting`/`DEBRIEF_VOICE_ID` in `lib/personas.ts`. If you add a new input field, keep it out of `DebriefReportInput` unless it's meant to be candidate-visible — `hiringScore` is deliberately excluded, see [08_security.md](08_security.md).
- Debrief offer/skip/end flow and stages (`'debrief-offer'`, `'debrief'`): `components/InterviewSession.tsx` (`handleTalkToPanel`, `handleSkipDebrief`, `handleEndDebrief`).
- Debrief call UI (transcript panel, controls, visualizer): `components/DebriefCall.tsx` — mirrors `ConversationComponent.tsx`'s hook usage (StrictMode `isReady` guard, hook-ownership rules) but has no persona timeline/countdown.
- Safety-cap duration: `SAFETY_CAP_MS` in `components/DebriefCall.tsx`.
- Request/response contract: `debrief`/`debriefReport` fields on `ClientStartRequest`, `DebriefReportPayload`, `DebriefCallProps` in `types/conversation.ts`.

Validation path:

1. `pnpm run lint`
2. `pnpm run typecheck`
3. `pnpm run verify:api`
4. `pnpm run build`
5. Manually verify a real call end-to-end: let the interview finish, confirm the debrief offer appears, take the "Talk to the panel" path and confirm the agent speaks the canned greeting and never states a score, then confirm "I'm Done" (and separately, the safety-cap timer) both land on the same report screen as "Skip to my written report".

## Change Transcript Rendering

1. Update transforms in `lib/conversation.ts`.
2. Update wiring in `components/ConversationComponent.tsx`.
3. Ensure `IN_PROGRESS` is separated from history, `INTERRUPTED` retained in history.
4. Re-check [transcript_pipeline.md](L2/transcript_pipeline.md) for consistency.

## Ship-Readiness Workflow

1. Run `pnpm run verify`.
2. Confirm docs alignment (`README`, guides, `AGENTS`, `docs/ai`).
3. Use conventional commit and branch naming.

## Progressive Disclosure Doc Workflow

- `generate docs`: create `docs/ai/` tree when absent.
- `update docs`: refresh after workflow/interface/security changes.
- `test docs`: execute question-based validation and write `docs/ai/test-results.md`.
- `fix docs`: close findings from `docs/ai/test-results.md` or a docs review.

## Workflow: Implement a Baseline Recipe Repo

1. Treat this repo as the official Agora Next.js quickstart baseline.
2. Do not recreate Agora ConvoAI integration from memory.
3. Follow [from_scratch_bootstrap.md](L2/from_scratch_bootstrap.md) for the implementation map and checklist.
4. Preserve the recipe invariants in `docs/ai/RECIPE.md`.
5. Run the verification commands before publishing a derivative.

## Workflow: Add a New API Route

1. Add route under `app/api/<route-name>/route.ts`.
2. Define payload types in `types/conversation.ts` if shared with client.
3. Add/update contract verification in `scripts/verify-api-contracts.ts`.
4. Run `pnpm run verify:api` and `pnpm run typecheck`.
5. Update `README.md` and `docs/ai/L1/06_interfaces.md`.

## Workflow: Modify Transcript UX

1. Update transforms in `lib/conversation.ts`.
2. Update render usage in transcript/layout components.
3. Validate edge states (`IN_PROGRESS`, `INTERRUPTED`, empty history).
4. Reconcile guidance in [transcript_pipeline.md](L2/transcript_pipeline.md).
5. Run `pnpm run lint` and `pnpm run build`.

## Workflow: Enable BYOK Provider Path

1. Uncomment relevant provider block in invite route.
2. Add the provider variables shown in the lower README BYOK section to your local environment.
3. Keep default no-key path intact for baseline quickstart behavior.
4. `NEXT_LLM_API_KEY`/`NEXT_LLM_URL` are the one exception already scaffolded (commented) in `env.local.example`, since they also gate LLM-quality feedback reports — other BYOK variables (Deepgram/ElevenLabs) stay out of it; they are not part of the base contract.
5. Re-run `pnpm run verify` before shipping.

## Workflow: Docs Refresh After Runtime Changes

1. Update L1 files matching changed subsystem.
2. Update or add L2 deep dives if L1 explanation exceeds concise bounds.
3. Bump `Last Reviewed` in `L0_repo_card.md`.
4. Re-run docs test and append retest notes for any fixes.

## Related Deep Dives

- [conversation_lifecycle.md](L2/conversation_lifecycle.md) — Full runtime sequence for bootstrap, switch, and teardown tasks.
- [from_scratch_bootstrap.md](L2/from_scratch_bootstrap.md) — Baseline implementation checklist for recipe consumers.
- [transcript_pipeline.md](L2/transcript_pipeline.md) — Required checks when editing transcript flow.
- [invite_agent_config.md](L2/invite_agent_config.md) — Agent construction detail for "Change Agent Behavior" and "Add a New Persona".
- [persona_handoff.md](L2/persona_handoff.md) — Persona switch sequence and context hand-off detail.
