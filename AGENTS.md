# Agent Development Guide

This guide is for coding agents making changes in **Multi Persona**, the AI interview-panel product built on `agent-quickstart-nextjs` (repo folder: `qs-check2`).

## How to Load

This repository uses progressive disclosure documentation. Docs live under `docs/ai/` in three levels.

1. Read [docs/ai/L0_repo_card.md](docs/ai/L0_repo_card.md) to identify the repo.
2. Load ALL 8 files in [docs/ai/L1/](docs/ai/L1/). They are small — load all upfront.
3. Follow L2 deep-dive links only when L1 isn't detailed enough. The index is at [docs/ai/L1/L2/_index.md](docs/ai/L1/L2/_index.md).

This repo declares `Recipe Role: base` in L0, so also read [docs/ai/RECIPE.md](docs/ai/RECIPE.md) when evaluating extension points, invariants, or stable contracts.

The sections below (Start Here, Patterns, Anti-Patterns, etc.) remain the canonical contributor handbook for hands-on work; the `docs/ai/` tree is the structured summary used by AI agents.

## Start Here

- Read [README.md](./README.md) for setup, commands, verification, and deployment.
- Use [docs/ai/RECIPE.md](docs/ai/RECIPE.md) for the base quickstart recipe contract.
- Use [docs/ai/L1/L2/from_scratch_bootstrap.md](docs/ai/L1/L2/from_scratch_bootstrap.md) for the baseline implementation map.
- Use [docs/ai/L1/L2/transcript_pipeline.md](docs/ai/L1/L2/transcript_pipeline.md) for transcript and RTM behavior.
- Use [docs/ai/L1/L2/persona_handoff.md](docs/ai/L1/L2/persona_handoff.md) for the persona-switch mechanism and context hand-off.
- Use [docs/ai/L1/L2/invite_agent_config.md](docs/ai/L1/L2/invite_agent_config.md) for agent construction, per-persona prompt/voice, and session options.
- For layout and responsibilities inside `components/`, `app/api/`, and `lib/`, use [docs/ai/L1/03_code_map.md](docs/ai/L1/03_code_map.md) and [docs/ai/L1/02_architecture.md](docs/ai/L1/02_architecture.md).

## Current System Shape

- App shell: Next.js 16 App Router, React 19, and TypeScript
- Client RTC: `agora-rtc-react` hooks over `agora-rtc-sdk-ng`
- Messaging: `agora-rtm` for transcripts, agent state, metrics, and error events
- Toolkit core: `agora-agent-client-toolkit` for `AgoraVoiceAI`, transcript helpers, and turn status
- UI components: `agora-agent-uikit` for visualizer, transcript, and mic controls
- Server SDK: `agora-agents` for managed agent session startup, one persona at a time on a fixed agent UID
- Storage: Postgres via `drizzle-orm`/`pg` (`lib/db`) — `sessions`, `candidateContext`, `reports`, `events`
- Product layer: `lib/personas.ts` (persona definitions, prompt/greeting builders, plus debrief prompt/greeting/voice builders), `lib/report.ts` (feedback report generation, LLM + heuristic fallback), and `lib/mailer.ts` (recruiter report email, best-effort)
- API routes: token generation, agent invite, chat, stop, and session/report routes live in `app/api`
- Default agent config: Agora-managed STT, LLM, and TTS, with a distinct voice per persona; `.env.local` requires Agora project credentials plus `DATABASE_URL`, with `NEXT_LLM_API_KEY`/`NEXT_LLM_URL` optional for LLM-quality feedback reports and `EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` optional for recruiter report emails
- Groq (`lib/groq.ts`, server-only, `GROQ_API_KEY` optional): summarizes persona hand-off context in `app/api/invite-agent/route.ts` and is tried before `NEXT_LLM_API_KEY` for feedback reports in `lib/report.ts`; falls back to pre-Groq behavior when unset or on failure
- Panel timing: each active persona gets a recruiter-set minute budget (`personaDurations` on `sessions`); `ConversationComponent.tsx` runs the countdown that drives auto-switch and auto-end (no candidate-facing switch control) — see [docs/ai/L1/L2/persona_handoff.md](docs/ai/L1/L2/persona_handoff.md)
- Post-interview debrief: after the report is generated, `InterviewSession.tsx` offers the candidate an optional spoken Q&A with the panel about their own report (`'debrief-offer'`/`'debrief'` stages), handled by a dedicated `components/DebriefCall.tsx` (not a persona switch — no `PersonaId`, no countdown); ends via a manual "I'm Done" button or a client-side safety-cap timer — see [docs/ai/L1/L2/persona_handoff.md](docs/ai/L1/L2/persona_handoff.md#not-a-persona-switch-the-post-interview-debrief)

## Supported Modes

### Local Development

- Run from the repo root with `pnpm run dev`.
- Next.js serves the app and the route handlers at `http://localhost:3000`.
- Local credentials are read from `.env.local`, usually written by `agora project env write .env.local`.

### Vercel Deployment

- Deploy the repository as a single Next.js app.
- Set `NEXT_PUBLIC_AGORA_APP_ID`, `NEXT_AGORA_APP_CERTIFICATE`, and `DATABASE_URL` in the deployment target.
- Keep `NEXT_AGORA_APP_CERTIFICATE` server-side only.
- Run `pnpm run db:push` against the target database before first deploy (or after a schema change).

## Routing / Ownership

- UI and RTC/RTM client lifecycle live in `components`.
- Browser-facing API routes live in `app/api`.
- Shared constants and transcript normalization live in `lib`.
- If a workflow, request contract, or ownership boundary changes, update `README.md`, `AGENTS.md`, and the relevant `docs/ai/` files in the same change.

## Key Files

- `app/api/generate-agora-token/route.ts`: issues RTC + RTM tokens for the browser user.
- `app/api/invite-agent/route.ts`: starts the managed agent session; edit here for system prompt, VAD, model, or voice changes. Also handles persona-switch fields (`persona`, `priorContext`, `fromPersona`) and the `handoff_log` write, plus the debrief fields (`debrief`, `debriefReport`) that start the post-interview debrief agent on the same channel/UID.
- `app/api/stop-conversation/route.ts`: stops the agent session.
- `app/api/chat/completions/route.ts`: optional OpenAI-compatible SSE proxy for a custom LLM (not wired by default).
- `app/api/session/route.ts`: recruiter creates a session (`recruiterEmail`, `roleTitle`, `focusAreas`, `activePersonas`, `personaDurations`).
- `app/api/session/[id]/route.ts`: loads a session (minus `recruiterEmail`, stripped server-side) + `candidateContext` for the candidate flow; also returns `completed: boolean` (a `reports` row already exists for this session) so the client can block a re-used interview link.
- `app/api/session/[id]/report/route.ts`: generates and persists the end-of-call feedback report (accepts an optional `candidateName`, threaded from the mic check into the report); on the first report for a session, emails it to `recruiterEmail` via `lib/mailer.ts`.
- `components/SetupScreen.tsx`: recruiter-facing two-column setup form (recruiter email, role/focus areas, per-persona minute budgets) and candidate link generation.
- `components/MicCheck.tsx`: pre-join mic permission/device check plus candidate name capture (`onConfirm(candidateName)`), required before "Continue" is enabled.
- `components/InterviewSession.tsx`: candidate flow orchestrator — session bootstrap, persona-switch delegation, report generation, stage management, converts `personaDurations` (minutes) to `personaDurationsSeconds`; blocks `mic-check` in favor of a "completed" stage when the link has already been used, and closes the tab (falling back to a "you may close this tab" stage) instead of resetting to `mic-check` when the candidate clicks "Done" on the report screen.
- `components/ConversationComponent.tsx`: RTC join, mic publication, `AgoraVoiceAI` init, transcript state, renewals, `personaTimeline` tracking, and the countdown timer driving auto-switch/auto-end.
- `components/PersonaSwitcher.tsx`: read-only mid-call panel status row with a live countdown badge — no click/switch interaction.
- `components/InterviewReport.tsx`: end-of-call feedback report UI.
- `components/QuickstartConversationLayout.tsx`: in-call header, transcript rail, controls dock, and `personaPanel` slot.
- `components/QuickstartPipelineMetrics.tsx`: per-stage latency chips from `AGENT_METRICS`.
- `components/QuickstartTranscriptPanel.tsx`: live transcript rail with persona-switch dividers.
- `lib/agora.ts`: shared agent UID defaults (fixed across all personas).
- `lib/personas.ts`: persona definitions, prompt/greeting builders.
- `lib/report.ts`: server-only feedback report generation (LLM + heuristic fallback).
- `lib/mailer.ts`: server-only recruiter report email delivery (Gmail SMTP via `nodemailer`, resolves `false` instead of throwing when unconfigured or on failure).
- `lib/conversation.ts`: transcript normalization, visualizer state mapping, and persona attribution helpers.
- `lib/db/schema.ts`: `sessions` / `candidateContext` / `reports` / `events` tables.
- `env.local.example`: local environment template.
- `scripts/verify-api-contracts.ts`: route contract verification.

## Patterns

### StrictMode Guard (`isReady`)

Both `useJoin` and `useLocalMicrophoneTrack` are gated by `isReady` to prevent double initialization in React StrictMode dev mode. The cleanup fires synchronously before any `setTimeout`, so only the real second mount's timer fires.

```tsx
const [isReady, setIsReady] = useState(false);
useEffect(() => {
  let cancelled = false;
  const id = setTimeout(() => {
    if (!cancelled) setIsReady(true);
  }, 0);
  return () => {
    cancelled = true;
    clearTimeout(id);
    setIsReady(false);
  };
}, []);
const { isConnected: joinSuccess } = useJoin(config, isReady);
const { localMicrophoneTrack } = useLocalMicrophoneTrack(isReady);
```

### Hook Ownership

- `useJoin` owns `client.leave()`; never call it manually.
- `useLocalMicrophoneTrack` owns track lifecycle; do not manually call `.close()`.
- `usePublish` owns publish state; mute with `track.setEnabled()` and do not manually unpublish.

### AgoraVoiceAI Init

Initialize `AgoraVoiceAI` from `agora-agent-client-toolkit` inside `ConversationComponent`, gated on `isReady && joinSuccess`.

```tsx
useEffect(() => {
  if (!isReady || !joinSuccess) return;
  // AgoraVoiceAI.init() is called here exactly once.
}, [isReady, joinSuccess]);
```

`isReady` becomes true only after the StrictMode fake-unmount cycle completes. Once `isReady` is true, React does not double invoke the effect for later dependency changes such as `joinSuccess` becoming true.

### Transcript and UI Mapping

- Manage `transcript` and `agentState` through `useState` plus `ai.on(TRANSCRIPT_UPDATED, ...)` and `ai.on(AGENT_STATE_CHANGED, ...)`.
- The toolkit uses `uid="0"` as a sentinel for the local user's speech. Remap that value to `client.uid` before passing messages into `QuickstartTranscriptPanel`, or user speech renders on the agent side.
- Include `INTERRUPTED` turns in `messageList`; filter only `IN_PROGRESS`. If the agent's first turn is interrupted and omitted, `messageList` stays empty and the transcript panel never shows that first turn.

### Tokens and Styling

- RTM token access must come from `RtcTokenBuilder.buildTokenWithRtm`; a standard RTC-only token does not grant RTM access.
- Tailwind must scan uikit classes with `./node_modules/agora-agent-uikit/dist/**/*.{js,mjs}` in `tailwind.config.ts`.

### Persona Switching

- The agent UID (`DEFAULT_AGENT_UID` in `lib/agora.ts`) is fixed across every persona — never make it vary per persona. A switch is a stop-and-restart of one agent session on the same UID, not a second agent joining. See [docs/ai/L1/L2/persona_handoff.md](docs/ai/L1/L2/persona_handoff.md).
- Switching is timer-driven only — `ConversationComponent`'s per-persona countdown (seeded from `personaDurationsSeconds`) is the sole trigger for a switch or for auto-ending the interview on the last persona. `PersonaSwitcher.tsx` is intentionally read-only; don't reintroduce an `onSwitch`/click control on it.
- Context hand-off between personas is a prompt-injection (`priorContext` appended into the next persona's system prompt), not a separate summarization call — don't add one without a strong reason.
- `lib/report.ts` is server-only; import `ReportTranscriptTurn`/`FeedbackReport` from `types/conversation.ts` in client components, never from `lib/report.ts` directly.
- `lib/mailer.ts` is server-only; never import it from a `'use client'` file. `sendRecruiterReportEmail` is fired once per session (first report only) by `app/api/session/[id]/report/route.ts` and never blocks or fails the candidate-facing report on an email error.

### Post-Interview Debrief

- The debrief reuses the same stop-and-restart-on-fixed-UID mechanism as a persona switch (`app/api/invite-agent/route.ts` with `debrief: true` instead of `persona`), but it is not a persona switch: no `PersonaId`, no `activePersonas` entry, no `personaTimeline` update, no countdown. Keep it in its own `components/DebriefCall.tsx` rather than threading a synthetic persona through `ConversationComponent`'s persona-coupled machinery. See [docs/ai/L1/L2/persona_handoff.md](docs/ai/L1/L2/persona_handoff.md#not-a-persona-switch-the-post-interview-debrief).
- `InterviewSession.handleEndConversation` defers RTM logout/`agoraData` teardown (instead of doing it immediately, as it did pre-debrief) so the connection survives report generation and a possible debrief; teardown now happens in `handleSkipDebrief`/`handleEndDebrief`. Don't reintroduce immediate teardown in `handleEndConversation` without re-checking this.
- `FeedbackReport.hiringScore` must never reach the candidate. This is enforced structurally, not just by prompt instruction: `DebriefReportInput` (`lib/personas.ts`) and `DebriefReportPayload` (`types/conversation.ts`) both omit the field entirely, and `handleTalkToPanel` in `InterviewSession.tsx` explicitly picks only `{ overallSummary, focusAreaCoverage, personas }` before sending it. `buildDebriefSystemPrompt` also instructs the model never to state a score/verdict as defense in depth. Don't widen either type to include `hiringScore`.
- The debrief has no server-enforced length limit — `SAFETY_CAP_MS` in `components/DebriefCall.tsx` (client-side timer) plus the Agora session's own `idleTimeout: 30` fallback are the only bounds.

## Working Rules

- Prefer the smallest change that keeps the quickstart copyable and production-style.
- Keep RTC client creation StrictMode-safe with `useRef`, not `useMemo`.
- Keep token generation on `RtcTokenBuilder.buildTokenWithRtm`.
- Keep transcript UID remapping aligned with the toolkit sentinel behavior.
- Do not require third-party vendor API keys unless the code actually introduces a BYOK provider path.
- Keep README, AGENTS, and `docs/ai/` aligned with implementation changes.

## Commands

From the repo root:

```bash
pnpm install
pnpm run doctor
pnpm run dev
pnpm run verify
```

Useful narrower checks:

```bash
pnpm run lint
pnpm run typecheck
pnpm run verify:api
pnpm run build
```

## Verification Safety

- Safe without live Agora credentials:
  - `pnpm run lint`
  - `pnpm run typecheck`
  - `pnpm run verify:api`
  - `pnpm run build`
- Requires local env setup but not a live Agora session:
  - `pnpm run doctor`
  - `pnpm run verify`
- Often blocked inside restricted sandboxes because of port binding or process spawning:
  - `pnpm run dev`

## Anti-Patterns / What NOT To Do

- Do not call `client.leave()` manually; it breaks `useJoin` cleanup.
- Do not call `localMicrophoneTrack.close()` manually; it breaks hook ownership.
- Do not remove the `isReady` guard.
- Do not set `reactStrictMode: false` as a workaround.
- Do not use the deprecated `turnDetection.type: 'agora_vad'` flat API; use `turnDetection.config.start_of_speech` and `turnDetection.config.end_of_speech`.
- Do not replace `RtcTokenBuilder.buildTokenWithRtm` with an RTC-only token builder.
- Do not hide SDK requirements only in `CLAUDE.md`; all agent-facing guidance belongs in `AGENTS.md`.

## Done Criteria

Before finishing a change:

1. Run the narrowest relevant verification command.
2. For shipped app/runtime changes, ensure `pnpm run verify` passes.
3. If you changed files in `components/` or `app/api/`, verify that `README.md`, this file, and the relevant `docs/ai/` files still match the implementation.
4. Update root README and affected docs when workflow, request contracts, architecture, or environment guidance changes.
5. If the change touches workflows, interfaces, gotchas, or security details, update the matching file under [docs/ai/L1/](docs/ai/L1/) and bump `Last Reviewed` in [docs/ai/L0_repo_card.md](docs/ai/L0_repo_card.md).

## Git Conventions

### Commit messages — conventional commits

- **Format:** `type: description` or `type(scope): description`
- **Types:** `feat:` (new feature), `fix:` (bug fix), `chore:` (maintenance, version bumps), `test:` (test additions/changes), `docs:` (documentation)
- **Scoped variant:** `feat(scope):`, `fix(scope):` — e.g. `feat(api): add stop-conversation status flag`
- **Lowercase after prefix** — `feat: add feature`, not `feat: Add feature`
- **Present tense** — "add feature", not "added feature"
- **PR number appended** — `feat: add feature (#123)`

### Branch names

- **Format:** `type/short-description` — lowercase, hyphen-separated
- **Types match commit types:** `feat/`, `fix/`, `chore/`, `test/`, `docs/`
- **Examples:** `feat/agent-metrics`, `fix/transcript-uid`, `docs/progressive-disclosure`

### General rules

- **No AI tool names** — never mention claude, cursor, copilot, cody, aider, gemini, codex, chatgpt, or gpt-3/4 in commit messages or PR descriptions.
- **No Co-Authored-By trailers** — omit AI attribution lines.
- **No `--no-verify`** — let git hooks run normally.
- **No git config changes** — do not modify `user.name` or `user.email`.

## Doc Commands

| Command         | When to use                                                  |
| --------------- | ------------------------------------------------------------ |
| generate docs   | No `docs/ai/` directory exists yet                           |
| update docs     | Code changed since the `Last Reviewed` date in L0            |
| test docs       | Verify docs give agents the right context (writes `docs/ai/test-results.md`) |
| fix docs        | Close findings from a docs review or test run                |

The generator and tester live in the [AgoraIO-Community/ai-devkit](https://github.com/AgoraIO-Community/ai-devkit) skill set. See the [progressive disclosure standard](https://github.com/AgoraIO-Community/ai-devkit/blob/main/docs/progressive-disclosure-standard.md) for the full specification.
