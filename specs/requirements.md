# Requirements — Panel: Coordinated AI Interview Panel

**Hackathon:** EchoSphere — Agora Conversational AI Hackathon (Knotic)
**Track:** Coordinated AI Interview Panel
**Status:** Draft for team review

---

## 1. About the Project

**Panel** is a real-time, voice-native AI interview platform where a candidate is interviewed by a *panel* of AI personas — not one generic bot — each representing a different evaluator role (e.g. Technical, Product, Behavioral). The personas share a single evolving understanding of the candidate, hand off to each other based on what's relevant, adapt question difficulty to performance, catch vague or contradictory answers, and produce a structured, evidence-linked assessment at the end.

The point is not "an AI that asks interview questions." It's a panel that behaves like a real one: a technical interviewer can accept an implementation while the product interviewer challenges the candidate to justify it in business terms — live, in the same session, without a human writing that branching logic by hand.

Built on **Agora Conversational AI Engine** as the real-time voice layer (transport, turn-taking, interruption handling, memory, tool orchestration), with an orchestration layer on top that coordinates multiple persona agents against one shared candidate context.

### Goals for this hackathon
- Demonstrate a technically differentiated use of multi-agent orchestration, not a single-bot Q&A wrapper.
- Ship an end-to-end working demo: start a session → live interview with interruption/follow-ups → structured report — with no dead ends.
- Look and feel like a product, not a prototype: judges should be able to picture this being used by a real company in its current state.
- Be resilient on stage at the Delhi finale (flaky venue network, live mic conditions).
- Use a **Next.js app with a real backend**: Next.js API routes (`app/api`) are backed by a **Postgres database (Neon)** that persists session config, shared candidate context, and final reports server-side. The browser still holds live UI/session state during an interview, but durability (reconnect, cross-device report access, report history) comes from the database, not `localStorage`. See [design.md §1](./design.md#1-architecture-overview) and [design.md §8](./design.md#8-tech-stack-proposed).

### Non-goals (out of scope for hackathon build)
- Full ATS (applicant tracking system) integration — a mocked/lightweight version is enough.
- Video (facial expression / body language analysis) — voice-only. (This governs analyzing the *candidate*; it does not preclude a lightweight audio-reactive visual for the *personas* per R8 — see [design.md §7](./design.md#7-frontend-design-r8-r9). Photoreal video avatars for personas are explicitly out of the base build, stretch-only — [design.md §7](./design.md#7-frontend-design-r8-r9).)
- Support for arbitrary numbers of personas beyond 3 — fixed panel of 3 is sufficient to prove the concept.
- Multi-tenant billing and full user-account management (signup/login/roles) — single-team demo deployment is enough. A lightweight shared-passcode gate is sufficient where an access gate is needed at all. See [design.md §1](./design.md#1-architecture-overview).

---

## 2. Use Cases

### UC-1: Candidate takes a live AI panel interview
A candidate joins a session link, is clearly told they're speaking with an AI panel, and is interviewed by rotating personas who ask role-relevant questions, follow up dynamically based on their answers, and adjust difficulty as the conversation progresses. The candidate can interrupt, ask for clarification, or push back on a question, and the panel responds naturally rather than resetting to a script.

### UC-2: Recruiter/hiring team sets up an interview
Before the session, a team member configures the interview: job role, key skill areas to probe, and which persona roles are active. The system uses this to seed each persona's question strategy and shared context.

### UC-3: Recruiter reviews a structured, evidence-based report
After the interview ends, the recruiter receives a scorecard broken down by competency area, each claim linked back to the specific transcript moment that supports it — including any flagged contradictions or vague answers — rather than a black-box score.

### UC-4: Live "panel dynamics" moment (demo/judging showcase)
During the interview, when a candidate's answer has a clear cross-functional angle (e.g. a technical decision with a business tradeoff), a second persona proactively steps in to challenge or add to the first persona's line of questioning — visibly, in real time — rather than personas operating in isolated turns.

### UC-5: Session resilience
If a network hiccup or audio drop occurs mid-session, the system recovers gracefully (reconnect, resume context) rather than losing the interview state — critical for a live on-stage demo.

---

## 3. Functional Requirements

Format: **User Story** + **Acceptance Criteria** (EARS-style: WHEN / IF … THE SYSTEM SHALL …).

### R1 — End-to-end interview flow
**User story:** As a candidate, I want to go from joining a session to receiving a completed interview in one continuous flow, so the experience feels like a real interview, not a series of disconnected steps.

- WHEN a candidate opens their session link THE SYSTEM SHALL greet them, disclose they are speaking with an AI panel, and confirm audio is working before the interview begins.
- WHEN the interview starts THE SYSTEM SHALL have exactly one active persona speaking at a time, selected by the orchestrator.
- WHEN a candidate finishes answering a question THE SYSTEM SHALL either continue with a dynamic follow-up or hand off to another persona, without requiring manual/human intervention.
- WHEN the interview reaches its defined end condition (time limit or question coverage met) THE SYSTEM SHALL close the session with a clear spoken closing statement.
- WHEN the session ends THE SYSTEM SHALL automatically generate and persist the structured report without additional user action.

### R2 — Multi-persona orchestration
**User story:** As a candidate, I want to feel like I'm talking to a panel with distinct perspectives, not one bot switching topics.

- WHEN a persona is not actively speaking THE SYSTEM SHALL keep it "listening" (updating shared context) rather than idle/disconnected.
- WHEN a candidate's answer is topically relevant to a non-active persona's domain THE SYSTEM SHALL allow the orchestrator to hand off to that persona within the same conversational turn window.
- WHEN a handoff occurs THE SYSTEM SHALL make the new persona's first utterance reference the prior context (not restart cold).
- IF two personas would have conflicting reactions to the same answer (e.g. one accepts, one challenges) THEN THE SYSTEM SHALL surface both reactions in sequence rather than suppressing one.

### R3 — Natural voice interaction (via Agora Conversational AI Engine)
**User story:** As a candidate, I want to interrupt, ask for clarification, or pause naturally, like in a real conversation.

- WHEN the candidate begins speaking while a persona is talking THE SYSTEM SHALL stop the persona's speech (barge-in) within Agora's interruption handling.
- WHEN the candidate asks the panel to repeat or clarify a question THE SYSTEM SHALL respond appropriately without losing conversation state.
- WHEN the candidate goes silent beyond a configured threshold THE SYSTEM SHALL prompt gently rather than timing out abruptly.

### R4 — Shared candidate context & memory
**User story:** As a persona, I need to know what the candidate already said to other personas, so I don't repeat questions or miss contradictions.

- WHEN any persona receives a candidate answer THE SYSTEM SHALL update a single shared candidate-context store (claims, evidence, confidence signals).
- WHEN a persona formulates its next question THE SYSTEM SHALL read from the shared context to avoid duplicate questions already answered.
- IF a candidate's current answer conflicts with an earlier claim THEN THE SYSTEM SHALL flag it in the shared context as a contradiction, tagged with both transcript locations.

### R5 — Dynamic follow-ups & difficulty adjustment
**User story:** As a candidate, I want the difficulty to track my actual performance, not a fixed script.

- WHEN a candidate answers correctly/strongly THE SYSTEM SHALL escalate to a harder or deeper follow-up in that competency area.
- WHEN a candidate struggles or gives a vague answer THE SYSTEM SHALL probe for clarification before moving on, rather than marking it wrong silently.
- WHEN an answer is detected as vague (no concrete specifics) THE SYSTEM SHALL generate a targeted follow-up requesting specifics.

### R6 — Structured, evidence-based final report
**User story:** As a recruiter, I want a report I can trust and audit, not just a score.

- WHEN the report is generated THE SYSTEM SHALL include a score/assessment per competency area.
- WHEN any assessment claim is presented THE SYSTEM SHALL link it to the specific transcript excerpt(s) that justify it.
- WHEN contradictions or vague answers were flagged during the session THE SYSTEM SHALL list them explicitly in the report.
- WHEN the report is complete THE SYSTEM SHALL make it viewable in the web UI and exportable (PDF/markdown).

### R7 — AI disclosure & ethical boundaries
**User story:** As a candidate, I want to always know I'm talking to AI and understand the limits of the process.

- WHEN a session begins THE SYSTEM SHALL state clearly, in speech and in the UI, that the candidate is interacting with an AI panel.
- THE SYSTEM SHALL NOT present the AI's assessment as a final hiring decision — the UI SHALL label it as a recommendation/input for human review.

### R8 — Professional, polished UI
**User story:** As a recruiter/judge, I want the interface to look and feel like a real product.

- WHEN a user is on any screen THE SYSTEM SHALL present a consistent visual design system (typography, color, spacing) across setup, live interview, and report views.
- WHEN the interview is live THE SYSTEM SHALL show a real-time transcript with clear speaker labeling (per-persona identity, distinct color/icon).
- WHEN a persona is actively speaking THE SYSTEM SHALL show an audio-reactive visual indicator for that persona (not a static highlight alone), so the panel reads as present and alive, not a text log — [design.md §7](./design.md#7-frontend-design-r8-r9).
- WHEN the interview is live THE SYSTEM SHALL show a live-updating competency/assessment visualization (not just raw text) so progress is visible without reading a transcript.
- THE SYSTEM SHALL be usable and legible on a standard laptop screen size used for live demo presentation.

### R9 — Easy-to-use flow
**User story:** As a first-time user (candidate or recruiter), I want to understand what to do without instructions.

- WHEN a recruiter starts a new interview setup THE SYSTEM SHALL require no more than 3 short steps (role, focus areas, personas) before generating a session link.
- WHEN a recruiter's setup is confirmed THE SYSTEM SHALL persist the session config as a backend record (Postgres) keyed by `session_id`, and encode only that `session_id` into the generated link, so the link works from any device/browser.
- WHEN a candidate opens a session link THE SYSTEM SHALL require at most one click/action (e.g. "Join") to begin, after a mic check.
- IF the candidate's microphone is not accessible THEN THE SYSTEM SHALL detect this and show a clear inline fix, not a silent failure.

### R10 — End-to-end reliability for live demo
**User story:** As the team presenting at the Delhi finale, I need the full flow to work live, repeatably, under real conditions.

- WHEN a demo run is executed from setup through report THE SYSTEM SHALL complete without requiring a developer to intervene manually.
- IF Agora connectivity drops mid-session THEN THE SYSTEM SHALL attempt reconnection and resume from the last known context, read back from the backend session store (Postgres), rather than restarting the interview — durable even if the browser tab/device is lost.
- THE SYSTEM SHALL support a pre-recorded fallback demo video path as a presentation safety net (not a functional requirement of the app itself, but a requirement of the demo plan).
- THE SYSTEM SHALL log key session events (persona handoffs, tool calls, contradictions flagged) with timestamps to the backend session log (Postgres), surfaced in the UI for post-hoc debugging between rehearsal runs.

---

## 4. Success Criteria (how we know we're done)

- [ ] A recruiter can configure and launch a session in under 2 minutes.
- [ ] A candidate can complete a full voice interview with at least 2 persona handoffs and at least one visible "challenge" moment (UC-4).
- [ ] The candidate can successfully interrupt the AI mid-sentence and be understood.
- [ ] A structured report is generated automatically with evidence links and any flagged contradictions.
- [ ] The full flow (setup → interview → report) has been rehearsed end-to-end at least 5 times with no manual intervention.
- [ ] UI has a consistent design system applied across all 3 screens (setup, live interview, report).

---

## 5. Round 3 — Development Sprint Program Context

Shortlisted teams (this team included) build the above scope during a **one-week online development sprint**, with these program-provided resources:

| Resource | Purpose | Cadence |
|---|---|---|
| **1:1 mentor session** | Dedicated technical/product guidance with an assigned mentor | One scheduled session for the week — not standing office hours |
| **Agora Discord community** | Technical support (SDK/API questions, troubleshooting) | Async, available throughout the week |
| **Official WhatsApp group** | Announcements, product guidance, mentor communication | Async, available throughout the week |

**Mentorship focus areas** (what the assigned mentor is positioned to help with): Agora SDKs & APIs, Real-Time Communication (RTC), Voice AI & Conversational AI, AI Agents & Generative AI, Technical Architecture, Product Development, User Experience, Prototype Development, Technical Troubleshooting.

**Implication for R10 (reliability) and the build plan:** because the 1:1 mentor session is a single scheduled touchpoint rather than open-ended access, it is the highest-leverage moment in the week and should be spent on the one decision that blocks everything else downstream — the multi-agent-vs-hot-swap architecture question in [design.md §1](./design.md#1-architecture-overview). Everything else (library quirks, individual bugs, API usage questions) should be routed to Discord asynchronously so the mentor session isn't spent on things Discord can answer. WhatsApp is for schedule/deadline/announcement information only, not technical problem-solving.

By the end of the sprint, the deliverable is a **functional prototype** ready for final submission — this is the concrete target the Success Criteria above (§4) are written to satisfy.
