# EchoSphere 2026 — Competitor Landscape

Research notes on every project submitted to the EchoSphere 2026 hackathon (Commudle, community "knotic"), gathered for comparison against our own submission, **Multi Persona**. Source: https://www.commudle.com/communities/knotic/hackathons/echosphere/projects (10 projects total, checked 2026-09-02).

Purpose: use this as input for prioritizing which features to build next — see "Feature gaps to consider" at the bottom.

## Interview-focused projects (direct competitors)

| Project | Creator(s) | Submitted | Core idea |
|---|---|---|---|
| **Multi Persona** (us) | KRITGYA KUMAR + yuganshchauhan21 | Aug 30 | Recruiter-configured link → candidate does a live voice interview with a rotating panel of personas (technical/product/behavioral), context carried forward on hand-off, LLM feedback report to candidate + recruiter email |
| [EchoPanel](https://www.commudle.com/builds/echopanel-coordinated-ai-interview-panel) | Madhuri Sharma + Surbhi Singh | Sep 2 | Multiple personas (Technical/Product/Behavioural/Customer/Hiring Manager) share one live "Context Graph"; a "Turn Arbiter" picks who speaks next based on relevance/unchallenged claims rather than a fixed order; per-topic difficulty ramps with performance; final report links every verdict to a transcript timestamp |
| [AgentVox](https://www.commudle.com/builds/agentvox) | Ashutosh Gaurav + nicky | Aug 30 | One adaptive interviewer backed by a multi-agent pipeline (resume/context, evidence/follow-up, evaluation, final-assessment agents) that probes claims for evidence ("how did you measure that?") instead of moving down a fixed question list |
| [InterviewIQ](https://www.commudle.com/builds/ai-powered-voice-interviewr-and-coach) | Abhishek Singh + Nidhi Pal | Aug 30 | Enterprise-pitched: picks each follow-up by the largest "evidence gap," runs every question through a 5-point reliability/anti-hallucination gate, gives recruiters a live dashboard plus a frozen, quote-cited scorecard |
| [Interview ai agent](https://www.commudle.com/builds/interview-ai-agent) | Adarsh Sarode + Jigar Kumeriya | Aug 30 | Built on Lyzr Agent Studio: an Interviewer agent talks, a separate Evaluator agent silently scores each answer (clarity/relevance/depth/confidence) and that score decides whether the next question goes deeper or moves on |

## Other Agora Conversational AI projects (not interview-focused)

| Project | Creator | Submitted | Core idea |
|---|---|---|---|
| [AgoraCare Triage](https://www.commudle.com/builds/agoracare-triage-multilingual-healthcare-assistance-line-agent) | Amaan Ahmad | Aug 29 | Multilingual hospital/helpline triage bot, escalates to a human operator with a live summary when confidence is low |
| [Relay-ai](https://www.commudle.com/builds/relay-ai) | Sourabh + Anirban | Aug 29 | Multilingual/code-switching customer-support voice agent with human escalation |
| [SentinelAI](https://www.commudle.com/builds/sentinelai-real-time-ai-incident-commander) | Vetha Narayanan G + Akshaya I | Aug 30 | Joins an ops voice call as an AI participant, builds a live "Incident State" (facts vs. hypotheses, owners, risks), humans approve actions |
| [RapidAid AI](https://www.commudle.com/builds/rapidaid-ai-real-time-voice-emergency-reporting-intelligent-escalation) | Aswin Amala Jones + Udayakumar J | Sep 2 | Voice-first emergency reporting: collects incident details, GPS, confidence-scores the case, emails the emergency contact, escalates low-confidence cases to a human |
| [ARGUS](https://www.commudle.com/builds/argus-agora-powered-voice-web-automation) | thanoj madumuri | Sep 2 | Voice-commanded autonomous web/browser automation (form-filling, bookings) with human-in-the-loop for sensitive steps like OTP/payment |

## Where Multi Persona stands relative to the four real competitors

**Closest match — EchoPanel.** Its description opens with almost the same framing as ours ("multiple distinct AI interviewer personas — Technical, Product/Business, Behavioural... conduct a single conversation"), and it's the only other project structured around named personas rotating through one interview. Its rotation logic is more ambitious on paper: a shared "Context Graph" all personas read/write live, a relevance-driven "Turn Arbiter" instead of a fixed order, per-topic difficulty ramping, and timestamp-linked evidence in the report. Ours is a timer-driven, recruiter-preset rotation (fixed order, fixed per-persona minute budget) with hand-off done via prompt injection of prior context — simpler and more predictable, but not adaptive to conversation content the way EchoPanel and AgentVox both claim to be.

**AgentVox and InterviewIQ** both center on evidence-probing follow-ups ("you said X — how did you measure it?") driven by internal agent pipelines, rather than a panel of personas at all — a different axis of differentiation (depth-of-questioning vs. breadth-of-perspective). InterviewIQ in particular pitches hard on auditability (quote-cited scorecards, anti-hallucination gate) — a recruiter-trust angle we don't currently claim.

**Interview ai agent** is the lightest-weight of the four (built on a third-party agent-studio playground link, no dedicated live project), with a two-agent interviewer/evaluator split adjusting question depth — a smaller-scope version of the same "adapt based on the last answer" idea AgentVox/InterviewIQ pursue.

**What's genuinely distinct about Multi Persona right now:**
- The only one with a full recruiter workflow around the interview itself — a setup form (role, focus areas, per-persona minute budgets, recruiter email) that generates a shareable candidate link, plus candidate-name verification at mic-check and a link that can't be reused once a report exists.
- The only one that automatically emails the completed report to the recruiter as a matter of course (RapidAid AI emails a case notification, but that's an emergency-response use case, not interview screening).
- Where we're behind on paper: EchoPanel, AgentVox, and InterviewIQ all pitch some form of adaptive, evidence-aware questioning; our questions are persona-scripted plus context hand-off, not answer-driven follow-up depth.

## Feature gaps to consider

Ranked roughly by how much competitive ground they'd close, based on the comparison above:

1. **Per-answer evidence probing / adaptive follow-ups** — the single biggest gap vs. EchoPanel, AgentVox, and InterviewIQ. Today a persona works off its scripted question set plus hand-off context; none of them re-question a specific claim the candidate just made (e.g. "you said you reduced latency 40% — how did you measure that?"). This is the theme all three of our closest competitors independently converged on.
2. **Evidence-linked / quote-cited report** — InterviewIQ and EchoPanel both tie scorecard verdicts back to specific transcript quotes or timestamps. Our `lib/report.ts` report is currently a summary + heuristic fallback; adding direct quote citations per persona section would be a relatively small structural change with high credibility payoff for recruiters.
3. **Content-driven turn order** (EchoPanel's "Turn Arbiter") — a bigger, riskier change: today `ConversationComponent.tsx`'s countdown is the sole trigger for persona switches (fixed order, fixed budget, timer-driven — see `docs/ai/L1/L2/persona_handoff.md`). Moving to "switch when a topic is exhausted, not just when time runs out" would need real design work and isn't a drop-in change.
4. **Live recruiter dashboard during the call** — InterviewIQ and SentinelAI both mention a live view of what's happening mid-interview, not just a post-call report. We currently only surface a transcript/status panel to the candidate; nothing recruiter-facing exists during the live call.
5. **Anti-hallucination / reliability gate on generated questions** — InterviewIQ explicitly validates every question before it reaches the candidate. Worth considering if we start generating more dynamic (less templated) questions per (1) above.

None of this is committed — it's raw material for a future feature-prioritization conversation.
