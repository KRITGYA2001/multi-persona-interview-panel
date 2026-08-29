import {
  type AgentState,
  type AgentTranscription,
  TurnStatus,
  type TranscriptHelperItem,
  type UserTranscription,
} from 'agora-agent-client-toolkit';
import {
  type AgentVisualizerState,
  type IMessageListItem,
} from 'agora-agent-uikit';
import { getPersonaDefinition, type PersonaId } from '@/lib/personas';

export interface PersonaTimelineEntry {
  persona: PersonaId;
  since: number;
}

// Fixes compacted punctuation emitted by some TTS/ASR providers where sentence-ending
// characters run directly into the next word (e.g. "Hello.World" → "Hello. World").
export function normalizeTranscriptSpacing(text: string): string {
  return text
    .replace(/([.!?])([A-Za-z])/g, '$1 $2')
    .replace(/,([A-Za-z])/g, ', $1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Agora timestamps vary by source: some RTM payloads use Unix-seconds while
// RTC events use milliseconds. Values already above 1e12 are milliseconds; others need scaling.
export function normalizeTimestampMs(timestamp: number): number {
  return timestamp > 1e12 ? timestamp : timestamp * 1000;
}

// Maps the combined (agentState + RTC connection + agent presence) signal to the
// AgentVisualizer's display states. RTC transport problems take priority over
// agent-level state to avoid showing "listening" or "talking" during a reconnect.
export function mapAgentVisualizerState(
  agentState: AgentState | null,
  isAgentConnected: boolean,
  connectionState: string,
): AgentVisualizerState {
  if (
    connectionState === 'DISCONNECTED' ||
    connectionState === 'DISCONNECTING'
  ) {
    return 'disconnected';
  }

  if (
    connectionState === 'CONNECTING' ||
    connectionState === 'RECONNECTING'
  ) {
    return 'joining';
  }

  if (!isAgentConnected) {
    return 'not-joined';
  }

  switch (agentState) {
    case 'listening':
      return 'listening';
    case 'thinking':
      return 'analyzing';
    case 'speaking':
      return 'talking';
    case 'idle':
    case 'silent':
    default:
      return 'ambient';
  }
}

// Adapts a toolkit TranscriptHelperItem to the shape expected by agora-agent-uikit.
// `status` is cast via `unknown` because the two packages define structurally
// equivalent TurnStatus enums that TypeScript won't narrow across package boundaries.
// `_time` may arrive in seconds or milliseconds depending on the event source.
export function toMessageListItem(
  item: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>,
): IMessageListItem {
  return {
    turn_id: item.turn_id,
    uid: Number(item.uid) || 0,
    text: typeof item.text === 'string' ? item.text : '',
    status: item.status as unknown as IMessageListItem['status'],
    createdAt:
      typeof item._time === 'number'
        ? normalizeTimestampMs(item._time)
        : undefined,
  };
}

// uid="0" is the toolkit's sentinel for local-user speech. Without remapping it to
// the actual RTC UID, the transcript panel renders the user's speech on the agent's side.
// Also normalises punctuation spacing so all turns display consistently.
export function normalizeTranscript(
  transcript: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[],
  localUID: string,
) {
  return transcript.map((item) => {
    const remappedUID = item.uid === '0' ? localUID : item.uid;
    const normalizedText =
      typeof item.text === 'string'
        ? normalizeTranscriptSpacing(item.text)
        : item.text;
    return { ...item, uid: remappedUID, text: normalizedText };
  });
}

// Returns completed and interrupted turns for the message history list.
// IN_PROGRESS turns are intentionally excluded — they are rendered separately
// as a streaming partial bubble via getCurrentInProgressMessage.
// INTERRUPTED turns must be included: if the agent's first turn is cut off and
// omitted, messageList stays empty and the first interrupted turn is never shown.
// Sorted by createdAt: after a persona switch, the underlying transcript helper's
// array order is not guaranteed chronological (the new agent session's turns can
// land before older ones), which previously scrambled transcript display order,
// hand-off summaries, and the end-of-call report.
export function getMessageList(
  transcript: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[],
) {
  return transcript
    .filter((item) => item.status !== TurnStatus.IN_PROGRESS)
    .map(toMessageListItem)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

// Returns the single active in-progress turn, or null when none exists.
// At most one turn is in-progress at a time. The transcript panel renders this
// as a live streaming bubble, distinct from the static message history.
export function getCurrentInProgressMessage(
  transcript: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[],
) {
  const item = transcript.find((entry) => entry.status === TurnStatus.IN_PROGRESS);
  return item ? toMessageListItem(item) : null;
}

// Returns the persona that was active at a given transcript timestamp. The
// timeline is ordered oldest-first; the active entry is the last one whose
// `since` is <= ts. Falls back to the first entry (or 'technical') if ts
// predates every recorded switch, which can happen for turns whose
// createdAt arrives slightly before the timeline's initial seed entry.
export function getPersonaAtTimestamp(
  personaTimeline: PersonaTimelineEntry[],
  ts: number | undefined,
): PersonaId {
  if (personaTimeline.length === 0) return 'technical';
  if (typeof ts !== 'number') return personaTimeline[personaTimeline.length - 1].persona;

  let active = personaTimeline[0];
  for (const entry of personaTimeline) {
    if (entry.since <= ts) {
      active = entry;
    } else {
      break;
    }
  }
  return active.persona;
}

// Formats the transcript so far as plain "[Label]: text" lines for injection
// into the next persona's system prompt (see lib/personas.ts buildPersonaSystemPrompt).
// Truncated to the most recent turns so the prompt stays a safe size — the
// receiving LLM only needs enough context to avoid repeating questions, not
// the full call history.
const HANDOFF_MAX_CHARS = 6000;
const HANDOFF_MAX_TURNS = 40;

export function formatTranscriptForHandoff(
  messageList: IMessageListItem[],
  personaTimeline: PersonaTimelineEntry[],
  localUID: string,
): string {
  const recent = messageList.slice(-HANDOFF_MAX_TURNS);

  const lines = recent.map((item) => {
    const isCandidate = String(item.uid) === localUID;
    const label = isCandidate
      ? 'Candidate'
      : getPersonaDefinition(getPersonaAtTimestamp(personaTimeline, item.createdAt)).label;
    return `[${label}]: ${item.text}`;
  });

  let text = lines.join('\n');
  if (text.length > HANDOFF_MAX_CHARS) {
    text = text.slice(text.length - HANDOFF_MAX_CHARS);
  }
  return text;
}
