# 08 Security

> Security model, trust boundaries, secret handling, and safety controls for this quickstart.

## Trust Boundaries

- Browser is untrusted and never receives `NEXT_AGORA_APP_CERTIFICATE`.
- Next.js server routes hold credentials and mint scoped, expiring tokens.
- Agora cloud executes managed agent pipeline using server-issued credentials.

## Secret Handling Rules

- Keep `NEXT_AGORA_APP_CERTIFICATE` server-side only.
- Keep `DATABASE_URL` server-side only — it is read exclusively by `lib/db/index.ts` (server-only module) and never referenced from a client component.
- Do not expose BYOK provider API keys to client bundles, including `NEXT_LLM_API_KEY` and `GROQ_API_KEY`.
- Keep `GROQ_API_KEY` server-side only — it is read exclusively by `lib/groq.ts` (server-only module, never imported from a `'use client'` file) via `process.env.GROQ_API_KEY`.
- Keep `EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` server-side only — read exclusively by `lib/mailer.ts` (server-only module, never imported from a `'use client'` file) via `process.env.EMAIL_HOST_USER`/`process.env.EMAIL_HOST_PASSWORD`. Never log the password; `sendRecruiterReportEmail` logs only the error object on send failure, not credentials.
- `recruiterEmail` on the `sessions` row is server-only PII — `GET /api/session/[id]` strips it before responding to the (candidate-facing) client.
- `FeedbackReport.hiringScore` is recruiter-facing only (delivered via `lib/mailer.ts`'s report email) and must never reach the candidate. This is enforced structurally, not just by convention: `DebriefReportInput` (`lib/personas.ts`) and `DebriefReportPayload` (`types/conversation.ts`) are both narrower types that omit `hiringScore` entirely, so it cannot be threaded into the debrief agent's prompt (`POST /api/invite-agent` with `debrief: true`) even by accident. `InterviewSession.handleTalkToPanel` builds the payload by explicitly picking `{ overallSummary, focusAreaCoverage, personas }` off the `report` state, never by spreading the full `FeedbackReport`. `buildDebriefSystemPrompt` additionally instructs the model never to state or imply a score or a hire/no-hire verdict, as defense in depth beyond the type-level exclusion.
- Store secrets in `.env.local` for dev and deployment secret store in Vercel.
- `env.local.example` documents expected keys without real values.

## Token Security Model

- Tokens expire (default 1 hour).
- Token endpoint allows caller-provided UID/channel but still uses server secret signing.
- Renewal flow requests new RTC/RTM tokens near expiry.
- RTM capability is required and intentionally embedded by `buildTokenWithRtm`.

## Input Validation and Failure Handling

- Route handlers validate required fields and env availability.
- Errors return structured JSON with bounded detail.
- Stop route treats already-stopping/not-found agent as idempotent success.

## Agent Behavior Safety

- Prompt includes explicit honesty and non-hallucination policy for product claims.
- Agent failure message is constrained (`Please wait a moment.`) for degraded-path behavior.

## Operational Security Practices

- Run `pnpm run verify` before release changes.
- Avoid logging secrets; current logs are operational and should remain non-secret.
- Use least-privilege project bindings when managing Agora environments.

## Known Limits

- This quickstart is a sample app; it does not implement user auth/tenant isolation.
- `/api/session*` routes (session creation, candidate context, report read/write) are unauthenticated — anyone with a `session_id` (a UUID, not brute-forceable in practice, but not access-controlled either) can read or write it. Fine for the demo/interview-link model; not safe as-is for a multi-tenant product with untrusted recruiters.
- If productionizing, add authenticated route access and per-user authorization checks.

## Security Review Checklist

1. Confirm `NEXT_AGORA_APP_CERTIFICATE` is never referenced in client files.
2. Confirm token minting still uses server route only.
3. Confirm route error payloads do not leak secrets.
4. Confirm BYOK keys are optional and remain server-side.
5. Confirm docs do not instruct users to expose secrets in public config.

## Threat Notes for This Sample

- Token misuse risk is bounded by token expiry but still requires secure key custody.
- Public start/stop endpoints are unauthenticated in sample form; production needs auth.
- RTM message payloads are parsed defensively but should be treated as untrusted input.

## Hardening Steps for Productionization

- Add authenticated identity and authorization to all mutation routes.
- Scope agent start permissions per user/session ownership.
- Add rate limiting for token and invite endpoints.
- Add request tracing IDs for security incident investigation.
- Add environment-specific secret rotation policy and monitoring.

## Deployment Secret Checklist (Vercel)

- `NEXT_PUBLIC_AGORA_APP_ID` set for all required environments.
- `NEXT_AGORA_APP_CERTIFICATE` set as server-side secret only.
- `DATABASE_URL` set as server-side secret only, pointed at a production (not shared dev) Postgres instance.
- Optional BYOK keys (including `NEXT_LLM_API_KEY`, `GROQ_API_KEY`) set only when related provider block is enabled.
- Optional `EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` set as server-side secrets only, when recruiter report emails are desired; omit to skip email delivery without affecting candidate-facing report generation.
- Preview environments use non-production credentials.

## Security-Relevant Files

- `app/api/generate-agora-token/route.ts`
- `app/api/invite-agent/route.ts`
- `app/api/stop-conversation/route.ts`
- `app/api/session/route.ts`, `app/api/session/[id]/route.ts`, `app/api/session/[id]/report/route.ts`
- `lib/db/index.ts`, `lib/db/schema.ts`
- `lib/groq.ts`, `lib/report.ts`, `lib/mailer.ts`, `lib/personas.ts` (`DebriefReportInput`, `buildDebriefSystemPrompt`)
- `types/conversation.ts` (`DebriefReportPayload`)
- `components/InterviewSession.tsx` (`handleTalkToPanel` — builds the debrief payload)
- `env.local.example`
- `README.md` environment section

## Audit Trigger Events

Re-audit security docs when any of these change:

- token issuance logic
- agent start/stop route authorization assumptions
- environment variable set or naming
- provider integration path (default vs BYOK)

## Related Deep Dives

- [conversation_lifecycle.md](L2/conversation_lifecycle.md) — Token issuance and renewal sequence details.
- [transcript_pipeline.md](L2/transcript_pipeline.md) — RTM event surfaces and error propagation boundaries.
