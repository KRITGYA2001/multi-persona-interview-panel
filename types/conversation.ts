import type { RTMClient } from 'agora-rtm';
import type { PersonaId } from '@/lib/personas';

export interface AgoraTokenData {
  token: string;
  uid: string;
  channel: string;
  agentId?: string;
}

export interface ClientStartRequest {
  requester_id: string;
  channel_name: string;
  /** Which panel persona this agent session speaks as. Defaults to 'technical' if omitted. */
  persona?: string;
  /** Interview session this agent belongs to — used to load role/focus-area context from Postgres. */
  session_id?: string;
  /** Formatted transcript-so-far, passed when this session starts as a mid-call persona switch. */
  priorContext?: string;
  /** Persona the candidate was just switched away from, for handoff logging. */
  fromPersona?: string;
}

export interface FeedbackReportPersonaSection {
  persona: string;
  label: string;
  strengths: string[];
  concerns: string[];
  notableQuotes: string[];
}

export interface FeedbackReport {
  roleTitle: string;
  /** Candidate's name, captured on the mic-check screen; absent for pre-migration reports. */
  candidateName?: string;
  overallSummary: string;
  focusAreaCoverage: { focusArea: string; covered: boolean }[];
  personas: FeedbackReportPersonaSection[];
  /** Overall hiring likelihood for this role, 0-100. Recruiter-facing only (email), never shown to the candidate. */
  hiringScore: number;
  source: 'llm' | 'heuristic';
  generatedAt: string;
}

/** A single transcript turn, tagged with the persona active at the time it was spoken. */
export interface ReportTranscriptTurn {
  persona: PersonaId;
  speaker: 'candidate' | 'panelist';
  text: string;
}

export interface StopConversationRequest {
  agent_id: string;
}

export interface AgentResponse {
  agent_id: string;
  create_ts: number;
  state: string;
}

export interface AgoraRenewalTokens {
  rtcToken: string;
  rtmToken: string;
}

export interface ConversationComponentProps {
  agoraData: AgoraTokenData;
  rtmClient: RTMClient;
  onTokenWillExpire: (uid: string) => Promise<AgoraRenewalTokens>;
  /** Called when the candidate ends the call, with the full persona-tagged transcript for the report. */
  onEndConversation: (transcript: ReportTranscriptTurn[]) => void;
  currentPersona: PersonaId;
  /** Personas the recruiter enabled for this session's panel, in canonical order. */
  activePersonas: PersonaId[];
  /** Recruiter-configured time budget per persona, in seconds. */
  personaDurationsSeconds: Record<PersonaId, number>;
  isSwitchingPersona: boolean;
  switchError: string | null;
  /** Stops the current agent and starts a new one as `next`, carrying `transcriptText` into its prompt. Resolves false on failure. */
  onSwitchPersona: (next: PersonaId, transcriptText: string) => Promise<boolean>;
}
