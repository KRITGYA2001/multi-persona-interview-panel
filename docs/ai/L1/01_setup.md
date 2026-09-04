# 01 Setup

> Environment setup, commands, and safe verification flow for this quickstart.

## Runtime Requirements

- Node.js `>=22` (`package.json` engines field).
- `pnpm` package manager.
- Agora CLI (`agora`) for project binding and environment bootstrap.
- Agora project with Conversational AI enabled.

Install the Agora CLI from the root `README.md` instructions. On Windows, use the PowerShell installer first; if it fails, run the shell installer from Git Bash and then verify with `agora --help`.

## Install and Bootstrap

1. Install dependencies.
2. Bind an Agora project.
3. Write `.env.local`.
4. Verify setup before running.

```bash
pnpm install
agora login
agora project use <your-project>
agora project env write .env.local
agora project doctor --deep
```

## Required Environment Variables

- `NEXT_PUBLIC_AGORA_APP_ID`: Agora project App ID.
- `NEXT_AGORA_APP_CERTIFICATE`: Agora App Certificate (server only).
- `DATABASE_URL`: pooled Postgres connection string. `lib/db/index.ts` throws at import time if unset, so every `/api/session*` route (including `invite-agent`'s session-context lookup) fails immediately without it. Run `pnpm run db:push` after setting it.

Optional: `NEXT_LLM_API_KEY` / `NEXT_LLM_URL` enable LLM-generated feedback reports (heuristic fallback otherwise). Optional: `GROQ_API_KEY` enables Groq-powered persona hand-off summarization (`app/api/invite-agent/route.ts`) and is tried before `NEXT_LLM_API_KEY` for feedback report generation (`lib/report.ts`) — both fall back to their pre-Groq behavior when unset. Optional: `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` (Gmail SMTP) enable emailing the detailed feedback report to the recruiter after an interview ends (`lib/mailer.ts`) — when unset, reports are still generated and shown to the candidate, just not emailed. Agent behavior defaults live in code, and optional BYOK examples are documented later in the root README.

## Primary Commands

```bash
pnpm run dev
pnpm run lint
pnpm run typecheck
pnpm run verify:api
pnpm run build
pnpm run verify
```

## Verification Safety

Safe without live session:

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run verify:api`
- `pnpm run build`

Requires env/project binding:

- `pnpm run doctor`
- `pnpm run verify`

## Local Run Notes

- App + API routes run at `http://localhost:3000`.
- Recruiter flow: fill out `SetupScreen` (recruiter email, role title, focus areas, persona panel with per-persona minute budgets) to create a session and produce a candidate link.
- Candidate flow: open the link, pass `MicCheck`, and `InterviewSession.startConversation()` bootstraps token + RTM + invite flow for the first persona. Each persona auto-hands off to the next when its time budget expires; the interview ends automatically after the last persona's time runs out, or earlier if the candidate clicks "End conversation".
- If transcript or agent join fails, first run `agora project doctor --deep`. If every `/api/session*` call fails, check `DATABASE_URL` and that `pnpm run db:push` has been run.

## CI Expectations

- Build workflow badge exists in root `README.md`.
- Pre-ship expectation: `pnpm run verify` passes.
- Route contract tests are executed by `scripts/verify-api-contracts.ts`.

## Troubleshooting Matrix

| Symptom | Probable Cause | First Check | Fix Path |
| --- | --- | --- | --- |
| Agent never joins | Invite route or env mismatch | `pnpm run doctor` and invite route logs | Verify the shared agent UID and invite payload |
| Transcript missing | RTM token capability missing | Token route implementation | Ensure `buildTokenWithRtm` remains unchanged |
| `verify` fails at doctor | Project not bound | `agora project use` output | Re-bind project and rewrite `.env.local` |
| Mic publishes but no agent response | Agent start failed | UI warning (`agentJoinError`) | Inspect `/api/invite-agent` response |

## Local-Only vs Deploy-Specific

Local:

- Uses `.env.local` created by `agora project env write`.
- Uses `next dev --webpack`.
- Best for flow debugging and transcript behavior checks.

Vercel:

- Requires environment vars configured per environment scope.
- Keep `NEXT_AGORA_APP_CERTIFICATE` private server variable.
- Use `pnpm run build` locally before pushing deployment changes.

## Setup Change Checklist

When setup docs/config change:

1. Update `README.md` environment/commands sections.
2. Update `env.local.example` if variable set changes.
3. Update `docs/ai/L1/01_setup.md` and `L0_repo_card.md` `Last Reviewed`.
4. Run at least `pnpm run typecheck` and `pnpm run verify:api`.

## Related Deep Dives

- [conversation_lifecycle.md](L2/conversation_lifecycle.md) — Full start/join/teardown sequence.
- [transcript_pipeline.md](L2/transcript_pipeline.md) — RTM transcript/event pipeline internals.
