# 04 Conventions

> Implementation conventions that protect lifecycle correctness, transcript accuracy, and docs/code alignment.

## React and RTC Lifecycle

- Keep RTC client creation StrictMode-safe with `useRef`, not `useMemo`.
- Use `isReady` guard (`setTimeout(..., 0)` pattern) before `useJoin` and `useLocalMicrophoneTrack`.
- Do not disable React StrictMode as a workaround.

## Hook Ownership Rules

- `useJoin` owns `client.leave()`; never leave manually.
- `useLocalMicrophoneTrack` owns track lifecycle; never call `.close()` manually.
- `usePublish` owns publish state; mute with `track.setEnabled()`.

## Transcript Conventions

- `uid === "0"` from toolkit is local-user sentinel and must be remapped to real `client.uid`.
- Include `INTERRUPTED` in history list; only filter out `IN_PROGRESS`.
- Normalize punctuation spacing for compacted provider output.
- Normalize timestamps to milliseconds before issue rendering.

## Token and RTM Contract

- Token route must use `RtcTokenBuilder.buildTokenWithRtm`.
- RTC-only token builders break RTM login/subscription.
- Renewal flow independently mints RTC and RTM tokens while keeping shared channel.

## API and Error Handling Style

- Route handlers validate required body/env early and return clear status codes.
- Stop route is idempotent for already-stopping/not-found agent states.
- Frontend logs detailed technical errors and shows concise user-facing messages.

## Styling and UI Kit Rules

- Tailwind config must scan `./node_modules/agora-agent-uikit/dist/**/*.{js,mjs}`.
- Prefer existing quickstart layout components over introducing parallel shells.
- Use theme tokens (`bg-card`, `border-border`, `text-foreground`, etc. from `app/globals.css`) rather than hardcoded hex/literal Tailwind color classes, so the palette stays centrally controlled.

## Persona and Report Conventions

- Never vary `agentUid` per persona — it must always be `String(DEFAULT_AGENT_UID)` (see [persona_handoff.md](L2/persona_handoff.md)); presence detection and transcript speaker attribution both depend on this.
- Persona hand-off is prompt injection (`contextForPrompt` appended to the next persona's system prompt). When `GROQ_API_KEY` is set, `priorContext` is first summarized via `groqRespond()` (see [persona_handoff.md](L2/persona_handoff.md)); on missing key or failure it falls back to the raw `priorContext` transcript unchanged (pre-Groq behavior).
- `lib/report.ts` imports `ai`/`@ai-sdk/openai` and `lib/groq.ts`, and must stay server-only; never import it from a client component. The report builder tries Groq first (if `GROQ_API_KEY` is set), then `NEXT_LLM_API_KEY`/`NEXT_LLM_URL` via `@ai-sdk/openai`, then the heuristic report — each stage falls through to the next on missing config or failure, so a report is never left ungenerated. Keep new LLM failure paths inside their existing `try/catch`/null-check so the fallback chain always runs.
- `lib/groq.ts` is server-only (reads `GROQ_API_KEY` directly from `process.env`, never a `NEXT_PUBLIC_` var) and must never be imported from a `'use client'` file. `groqRespond()` returns `null` on any missing-key or request failure so call sites can fall back without special-casing errors.
- Persona switching is timer-driven only — `ConversationComponent`'s countdown is the sole trigger for `handleSwitchPersona`/auto-end. Don't reintroduce a candidate-facing `onClick`/`onSwitch` control on `PersonaSwitcher.tsx`; it is intentionally read-only.
- `lib/mailer.ts` is server-only (reads `EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` directly from `process.env`) and must never be imported from a `'use client'` file. `sendRecruiterReportEmail()` resolves `false` on any missing-config or send failure rather than throwing, matching the `groqRespond()` fallback philosophy — email delivery must never block or fail report generation for the candidate.
- The post-interview debrief reuses the persona-switch stop-and-restart mechanism (`agentUid` still fixed) but is not itself a persona — no `PersonaId`, no `personaTimeline` entry, no countdown; see [persona_handoff.md](L2/persona_handoff.md#not-a-persona-switch-the-post-interview-debrief). `FeedbackReport.hiringScore` must never be passed into the debrief prompt or payload — `DebriefReportInput`/`DebriefReportPayload` omit it at the type level, and `InterviewSession.tsx`'s `handleTalkToPanel` picks fields explicitly rather than spreading the full report.

## Documentation Synchronization

When changing workflow/contracts/ownership in `components` or `app/api`, update:

- `README.md`
- `AGENTS.md`
- `docs/ai/RECIPE.md` if extension points, invariants, or stable contracts changed
- relevant `docs/ai/L1/*.md` and `docs/ai/L0_repo_card.md` `Last Reviewed`

## Git Conventions

- Conventional commits: `type: description` or `type(scope): description`.
- Branch names: `type/short-description` lowercase with hyphens.
- No AI tool names in commit/PR text.
- No `--no-verify`, no git identity config edits.

## Route Handler Conventions

- Parse and validate request body at the top of handler.
- Return `400` for client payload problems and `500` for internal failures.
- Keep response payloads explicit and JSON-serializable.
- Prefer helper functions for repeated env checks or error classification.

## Commenting and Readability Style

- Comments should capture lifecycle reasoning or non-obvious constraints.
- Avoid comments that merely restate code.
- Keep runtime-sensitive constraints close to the guarded code path.

## Verification Conventions

- For route or contract changes, run `pnpm run verify:api` first.
- For UI/client runtime changes, run at least lint + typecheck + build.
- Prefer narrow checks during iteration, full `pnpm run verify` before handoff.

## Pull Request Hygiene

- Keep scope small and copyable for quickstart consumers.
- Include doc updates in same change when workflow/contracts are touched.
- Use present-tense lowercase conventional commit descriptions.
- Avoid adding hidden requirements not represented in `env.local.example` and README.

## Related Deep Dives

- [conversation_lifecycle.md](L2/conversation_lifecycle.md) — Why StrictMode guard and hook ownership are required.
- [transcript_pipeline.md](L2/transcript_pipeline.md) — UID remapping and turn-status handling rationale.
- [persona_handoff.md](L2/persona_handoff.md) — Fixed-agentUID rule and context hand-off mechanism in full.
