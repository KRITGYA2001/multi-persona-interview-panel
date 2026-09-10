'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AgoraRTC, {
  useRTCClient,
  useLocalMicrophoneTrack,
  useRemoteUsers,
  useClientEvent,
  useJoin,
  usePublish,
  RemoteUser,
  UID,
} from 'agora-rtc-react';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  AgentState,
  MessageSalStatus,
  TranscriptHelperMode,
  type TranscriptHelperItem,
  type UserTranscription,
  type AgentTranscription,
} from 'agora-agent-client-toolkit';
import { AgentVisualizer } from 'agora-agent-uikit';
import { MicButtonWithVisualizer } from 'agora-agent-uikit/rtc';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import {
  formatTranscriptForHandoff,
  getCurrentInProgressMessage,
  getMessageList,
  getPersonaAtTimestamp,
  mapAgentVisualizerState,
  normalizeTimestampMs,
  normalizeTranscript,
  type PersonaTimelineEntry,
} from '@/lib/conversation';
import type { PersonaId } from '@/lib/personas';
import { MicrophoneSelector } from './MicrophoneSelector';
import {
  getConversationIssueSeverity,
  type ConnectionIssue,
} from './ConversationErrorCard';
import { ConnectionStatusPanel } from './ConnectionStatusPanel';
import { PersonaSwitcher } from './PersonaSwitcher';
import { QuickstartConversationLayout } from './QuickstartConversationLayout';
import {
  QuickstartPipelineMetrics,
  type QuickstartAgentMetric,
} from './QuickstartPipelineMetrics';
import { QuickstartTranscriptPanel } from './QuickstartTranscriptPanel';
import { CodingQuestionPanel } from './CodingQuestionPanel';
import type {
  ConversationComponentProps,
  ReportTranscriptTurn,
} from '@/types/conversation';

// Cap the displayed issues list to avoid overwhelming the UI during a cascade of errors.
const MAX_CONNECTION_ISSUES = 6;

type AgoraRtcWithParameters = typeof AgoraRTC & {
  setParameter?: (key: string, value: unknown) => void;
};

// Payload shape for signaling-level errors forwarded by the agent over RTM.
// The `module` field identifies which backend subsystem (LLM / ASR / TTS) raised the error.
type RtmMessageErrorPayload = {
  object: 'message.error';
  module?: string;
  code?: number;
  message?: string;
  send_ts?: number;
};

// Payload shape for SAL (Session Abstraction Layer) registration status messages.
// VP_REGISTER_FAIL and VP_REGISTER_DUPLICATE indicate RTM channel subscription problems.
type RtmSalStatusPayload = {
  object: 'message.sal_status';
  status?: string;
  timestamp?: number;
};

// Type guard for RTM signaling-level error payloads (object: 'message.error').
function isRtmMessageErrorPayload(
  value: unknown,
): value is RtmMessageErrorPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { object?: unknown }).object === 'message.error'
  );
}

// Type guard for RTM SAL status payloads (object: 'message.sal_status').
function isRtmSalStatusPayload(value: unknown): value is RtmSalStatusPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { object?: unknown }).object === 'message.sal_status'
  );
}

export default function ConversationComponent({
  agoraData,
  rtmClient,
  onTokenWillExpire,
  onEndConversation,
  currentPersona,
  activePersonas,
  personaDurationsSeconds,
  isSwitchingPersona,
  switchError,
  onSwitchPersona,
  codingQuestion,
}: ConversationComponentProps) {
  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  const [isEnabled, setIsEnabled] = useState(true);
  const [isAgentConnected, setIsAgentConnected] = useState(false);
  const [isConnectionDetailsOpen, setIsConnectionDetailsOpen] = useState(false);

  // Records which persona was active over time, so completed transcript turns can be
  // attributed to the correct panelist even though every persona speaks as the same
  // fixed agentUID (see docs/ai/L1/L2/persona_handoff.md). Seeded once at mount with
  // whichever persona the call started as; subsequent switches append new entries.
  const [personaTimeline, setPersonaTimeline] = useState<PersonaTimelineEntry[]>(() => [
    { persona: currentPersona, since: Date.now() },
  ]);

  // Recruiter-configured per-persona countdown that drives auto hand-off/end
  // (see the zero-crossing effect below, after handleSwitchPersona/handleEndConversation).
  const [remainingSeconds, setRemainingSeconds] = useState(
    () => personaDurationsSeconds[currentPersona] ?? 300,
  );
  // Guards the zero-crossing effect so it fires exactly once per persona, even
  // if remainingSeconds briefly stays at 0 while the hand-off network call is in flight.
  const hasTriggeredZeroRef = useRef(false);

  useEffect(() => {
    setRemainingSeconds(personaDurationsSeconds[currentPersona] ?? 300);
    hasTriggeredZeroRef.current = false;
  }, [currentPersona, personaDurationsSeconds]);

  // Countdown ticks once per second, paused during the stop/start hand-off round-trip.
  useEffect(() => {
    if (isSwitchingPersona) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [isSwitchingPersona, currentPersona]);

  // Tracks granular RTC connection state for the status dot.
  // Agora states: DISCONNECTED | CONNECTING | CONNECTED | DISCONNECTING | RECONNECTING
  const [connectionState, setConnectionState] = useState<string>('CONNECTING');
  const agentUID = String(DEFAULT_AGENT_UID);
  const [joinedUID, setJoinedUID] = useState<UID>(0);

  // Transcript + agent state — managed with AgoraVoiceAI (see effect below).
  const [rawTranscript, setRawTranscript] = useState<
    TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[]
  >([]);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<QuickstartAgentMetric[]>([]);
  const [connectionIssues, setConnectionIssues] = useState<ConnectionIssue[]>(
    [],
  );
  const addConnectionIssue = useCallback((issue: ConnectionIssue) => {
    setConnectionIssues((prev) => {
      const isDuplicate = prev.some(
        (x) =>
          x.agentUserId === issue.agentUserId &&
          x.code === issue.code &&
          x.message === issue.message &&
          Math.abs(x.timestamp - issue.timestamp) < 1500,
      );
      if (isDuplicate) return prev;
      return [issue, ...prev].slice(0, MAX_CONNECTION_ISSUES);
    });
  }, []);

  // Auto-open details panel as soon as a new issue is recorded.
  useEffect(() => {
    if (connectionIssues.length > 0) {
      setIsConnectionDetailsOpen(true);
    }
  }, [connectionIssues.length]);

  // StrictMode guard: delay `useJoin`'s ready flag until after the fake-unmount
  // cycle completes. React StrictMode fires cleanup synchronously before any
  // setTimeout callback, so the first (fake) mount's timeout is always cancelled.
  // Only the real second mount's timeout fires, meaning useJoin joins exactly once.
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

  const { isConnected: joinSuccess } = useJoin(
    {
      appid: process.env.NEXT_PUBLIC_AGORA_APP_ID!,
      channel: agoraData.channel,
      token: agoraData.token,
      uid: parseInt(agoraData.uid, 10),
    },
    isReady,
  );

  // Create mic track only after the StrictMode fake-unmount cycle completes (isReady).
  // Passing `true` here creates two tracks in StrictMode — the first publishes, then
  // StrictMode cleanup closes it and the second takes over, causing a ~3s audio gap.
  // isReady uses the same setTimeout(fn,0) pattern as useJoin: StrictMode cleanup fires
  // synchronously before the timeout, so only the real second mount's timer fires.
  // Do NOT pass `isEnabled` — that ties track lifetime to mute state and breaks the Web Audio
  // graph inside MicButtonWithVisualizer. Mute uses track.setEnabled() only.
  const { localMicrophoneTrack } = useLocalMicrophoneTrack(isReady);

  // ENABLE_AUDIO_PTS is a module-level SDK parameter (not on the client instance).
  // It must be set before publishing audio for transcript timing to be accurate.
  useEffect(() => {
    if (!client) return;
    try {
      (AgoraRTC as AgoraRtcWithParameters).setParameter?.(
        'ENABLE_AUDIO_PTS',
        true,
      );
    } catch (error) {
      console.warn('Could not set ENABLE_AUDIO_PTS:', error);
    }
  }, [client]);

  // Track the auto-assigned RTC UID for token renewal and agent invite.
  useEffect(() => {
    if (joinSuccess && client) {
      const uid = client.uid;
      if (uid !== null && uid !== undefined) {
        setJoinedUID(uid);
      }
    }
  }, [joinSuccess, client]);

  // Initialize AgoraVoiceAI once the channel is joined.
  //
  // Gating on `isReady && joinSuccess` is critical for StrictMode safety:
  //   - `isReady` ensures we are past the initial fake-unmount cycle, so this
  //     effect only runs on the real mount (not the discarded fake one).
  //   - Once `isReady` is true, React does NOT double-invoke this effect for
  //     subsequent state changes (`joinSuccess` becoming true). That means
  //     AgoraVoiceAI.init() is called exactly once.
  useEffect(() => {
    if (!isReady || !joinSuccess) return;

    let cancelled = false;

    (async () => {
      try {
        const ai = await AgoraVoiceAI.init({
          rtcEngine: client,
          rtmConfig: { rtmEngine: rtmClient },
          renderMode: TranscriptHelperMode.TEXT,
          enableLog: true,
        });

        if (cancelled) {
          try {
            if (AgoraVoiceAI.getInstance() === ai) {
              // Tear down only the instance created by this effect run.
              ai.unsubscribe();
              ai.destroy();
            }
          } catch {}
          return;
        }

        ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (t) => {
          setRawTranscript([...t]);
        });
        // Agent state drives the visualizer, independent of RTC audio presence.
        ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_, event) =>
          setAgentState(event.state),
        );
        ai.on(AgoraVoiceAIEvents.AGENT_METRICS, (_, metrics) => {
          setAgentMetrics((prev) => [...prev, metrics].slice(-8));
        });
        ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (agentUserId, error) => {
          addConnectionIssue({
            id: `${Date.now()}-${agentUserId}-message-error-${error.code}`,
            source: 'rtm',
            agentUserId,
            code: error.code,
            message: error.message,
            timestamp: normalizeTimestampMs(error.timestamp),
          });
        });
        // SAL status: capture raw RTM messages so message.sal_status surfaces even if higher-level events don't.
        ai.on(
          AgoraVoiceAIEvents.MESSAGE_SAL_STATUS,
          (agentUserId, salStatus) => {
            if (
              salStatus.status === MessageSalStatus.VP_REGISTER_FAIL ||
              salStatus.status === MessageSalStatus.VP_REGISTER_DUPLICATE
            ) {
              addConnectionIssue({
                id: `${Date.now()}-${agentUserId}-sal-${salStatus.status}`,
                source: 'rtm',
                agentUserId,
                code: salStatus.status,
                message: `SAL status: ${salStatus.status}`,
                timestamp: normalizeTimestampMs(salStatus.timestamp),
              });
            }
          },
        );
        // Agent error: capture raw RTM messages so message.error surfaces even if higher-level events don't.
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUserId, error) => {
          addConnectionIssue({
            id: `${Date.now()}-${agentUserId}-agent-error-${error.code}`,
            source: 'agent',
            agentUserId,
            code: error.code,
            message: `${error.type}: ${error.message}`,
            timestamp: normalizeTimestampMs(error.timestamp),
          });
        });
        // subscribeMessage binds the toolkit to both RTC stream messages and RTM payloads.
        ai.subscribeMessage(agoraData.channel);
      } catch (error) {
        if (!cancelled) {
          console.error('[AgoraVoiceAI] init failed:', error);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        const ai = AgoraVoiceAI.getInstance();
        if (ai) {
          ai.unsubscribe();
          ai.destroy();
        }
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, joinSuccess]);

  // Raw RTM parsing is kept as a fallback for signaling-level errors and SAL status.
  useEffect(() => {
    const handleRtmMessage = (event: {
      message: string | Uint8Array;
      publisher: string;
    }) => {
      const payloadText =
        typeof event.message === 'string'
          ? event.message
          : new TextDecoder().decode(event.message);

      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadText);
      } catch {
        return;
      }

      if (isRtmMessageErrorPayload(parsed)) {
        const p = parsed;
        addConnectionIssue({
          id: `${Date.now()}-${event.publisher}-rtm-msg-error-${p.code ?? 'unknown'}`,
          source: 'rtm-signaling',
          agentUserId: event.publisher,
          code: p.code ?? 'unknown',
          message: `${p.module ?? 'unknown'}: ${p.message ?? 'Unknown signaling error'}`,
          timestamp: normalizeTimestampMs(p.send_ts ?? Date.now()),
        });
        return;
      }

      if (isRtmSalStatusPayload(parsed)) {
        const p = parsed;
        if (
          p.status === 'VP_REGISTER_FAIL' ||
          p.status === 'VP_REGISTER_DUPLICATE'
        ) {
          addConnectionIssue({
            id: `${Date.now()}-${event.publisher}-rtm-sal-${p.status}`,
            source: 'rtm-signaling',
            agentUserId: event.publisher,
            code: p.status,
            message: `SAL status: ${p.status}`,
            timestamp: normalizeTimestampMs(p.timestamp ?? Date.now()),
          });
        }
      }
    };

    rtmClient.addEventListener('message', handleRtmMessage);
    return () => {
      rtmClient.removeEventListener('message', handleRtmMessage);
    };
  }, [rtmClient, addConnectionIssue]);

  // The toolkit uses uid="0" for local user speech — remap to actual RTC UID
  // so the transcript panel renders user messages on the correct side.
  // Also normalize punctuation spacing for display when upstream text arrives compacted.
  const transcript = useMemo(() => {
    return normalizeTranscript(rawTranscript, String(client.uid));
  }, [rawTranscript, client.uid]);

  // Completed (END + INTERRUPTED) messages shown as history.
  // INTERRUPTED must be included — if the agent's first turn is cut off,
  // messageList stays empty and the first interrupted turn is never shown.
  const messageList = useMemo(() => getMessageList(transcript), [transcript]);

  const currentInProgressMessage = useMemo(() => {
    // The live partial turn renders separately from the completed history list.
    return getCurrentInProgressMessage(transcript);
  }, [transcript]);

  // Structural (not content-based) trigger for the coding panel: count panelist
  // turns since the current persona's timeline entry began. IN_PROGRESS turns are
  // included here (unlike messageList) so the panel appears as the 2nd question
  // starts being spoken, not only once it finishes.
  const panelistTurnsSincePersonaStart = useMemo(() => {
    const localUID = String(client.uid);
    const since = personaTimeline[personaTimeline.length - 1]?.since ?? 0;
    return transcript.filter((item) => {
      if (String(item.uid) === localUID) return false;
      const ts =
        typeof item._time === 'number' ? normalizeTimestampMs(item._time) : undefined;
      return typeof ts !== 'number' || ts >= since;
    }).length;
  }, [transcript, client.uid, personaTimeline]);

  const isCodingPanelEligible =
    currentPersona === 'technical' && codingQuestion != null && panelistTurnsSincePersonaStart >= 2;

  const codingPhaseSeconds = useMemo(() => {
    const budget = personaDurationsSeconds.technical ?? 0;
    return budget > 0 ? Math.min(8 * 60, Math.floor(budget / 2)) : 8 * 60;
  }, [personaDurationsSeconds]);

  const [isCodingPanelClosed, setIsCodingPanelClosed] = useState(false);
  const [codingRemainingSeconds, setCodingRemainingSeconds] = useState<number | null>(null);
  const hasCodingClosedRef = useRef(false);

  // Reset the coding phase whenever the active persona changes, mirroring the
  // main countdown's per-persona reset below.
  useEffect(() => {
    setIsCodingPanelClosed(false);
    setCodingRemainingSeconds(null);
    hasCodingClosedRef.current = false;
  }, [currentPersona]);

  // Seed the countdown exactly once, the moment the panel first becomes eligible.
  useEffect(() => {
    if (isCodingPanelEligible && codingRemainingSeconds === null) {
      setCodingRemainingSeconds(codingPhaseSeconds);
    }
  }, [isCodingPanelEligible, codingPhaseSeconds, codingRemainingSeconds]);

  // Ticks once per second while the panel is open, paused during a persona-switch round-trip.
  useEffect(() => {
    if (!isCodingPanelEligible || isCodingPanelClosed || isSwitchingPersona) return;
    if (codingRemainingSeconds === null) return;
    const interval = setInterval(() => {
      setCodingRemainingSeconds((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [isCodingPanelEligible, isCodingPanelClosed, isSwitchingPersona, codingRemainingSeconds]);

  // Zero-crossing closes the panel — this never triggers a persona switch,
  // it only hides the coding UI.
  useEffect(() => {
    if (
      isCodingPanelEligible &&
      !isCodingPanelClosed &&
      codingRemainingSeconds === 0 &&
      !hasCodingClosedRef.current
    ) {
      hasCodingClosedRef.current = true;
      setIsCodingPanelClosed(true);
    }
  }, [isCodingPanelEligible, isCodingPanelClosed, codingRemainingSeconds]);

  const showCodingPanel = isCodingPanelEligible && !isCodingPanelClosed;

  // Publish local mic once the track exists; usePublish waits for RTC connection.
  usePublish([localMicrophoneTrack]);

  useClientEvent(client, 'user-joined', (user) => {
    if (user.uid.toString() === agentUID) setIsAgentConnected(true);
  });

  useClientEvent(client, 'user-left', (user) => {
    if (user.uid.toString() === agentUID) setIsAgentConnected(false);
  });

  // Sync isAgentConnected with remoteUsers (covers cases where user-joined/left are missed)
  useEffect(() => {
    const isAgentInRemoteUsers = remoteUsers.some(
      (user) => user.uid.toString() === agentUID,
    );
    setIsAgentConnected(isAgentInRemoteUsers);
  }, [remoteUsers, agentUID]);

  useClientEvent(client, 'connection-state-change', (curState) => {
    setConnectionState(curState);
  });

  const connectionSeverity = useMemo<'normal' | 'warning' | 'error'>(() => {
    // RTC transport problems take precedence; otherwise derive severity from captured issues.
    if (
      connectionState === 'DISCONNECTED' ||
      connectionState === 'DISCONNECTING'
    ) {
      return 'error';
    }
    if (
      connectionState === 'CONNECTING' ||
      connectionState === 'RECONNECTING'
    ) {
      return 'warning';
    }
    if (connectionIssues.length === 0) {
      return 'normal';
    }
    return connectionIssues.some(
      (issue) => getConversationIssueSeverity(issue) === 'error',
    )
      ? 'error'
      : 'warning';
  }, [connectionState, connectionIssues]);

  const visualizerState = useMemo(
    () =>
      mapAgentVisualizerState(agentState, isAgentConnected, connectionState),
    [agentState, isAgentConnected, connectionState],
  );

  /**
   * Mute/unmute via track.setEnabled() only — usePublish owns publish state.
   * If we also unpublish in the toggle, usePublish and the button fight each other
   * and break the MicButtonWithVisualizer Web Audio graph.
   */
  const handleMicToggle = useCallback(async () => {
    const next = !isEnabled;
    const track = localMicrophoneTrack;
    if (!track) {
      setIsEnabled(next);
      return;
    }
    try {
      await track.setEnabled(next);
      setIsEnabled(next);
    } catch (error) {
      console.error('Failed to toggle microphone:', error);
    }
  }, [isEnabled, localMicrophoneTrack]);

  const handleTokenWillExpire = useCallback(async () => {
    if (!onTokenWillExpire || !joinedUID) return;
    try {
      // RTC and RTM renew independently, but the quickstart fetches both in one request.
      const { rtcToken, rtmToken } = await onTokenWillExpire(
        joinedUID.toString(),
      );
      await client?.renewToken(rtcToken);
      await rtmClient.renewToken(rtmToken);
    } catch (error) {
      console.error('Failed to renew Agora token:', error);
    }
  }, [client, onTokenWillExpire, joinedUID, rtmClient]);

  useClientEvent(client, 'token-privilege-will-expire', handleTokenWillExpire);

  // Persona switch = stop-and-restart the agent session on the same fixed agentUID
  // (see docs/ai/L1/L2/persona_handoff.md). This component builds the hand-off
  // transcript and records the timeline; the actual stop/start network calls live
  // in InterviewSession (onSwitchPersona), which owns agoraData.agentId.
  const handleSwitchPersona = useCallback(
    async (next: PersonaId) => {
      if (next === currentPersona || isSwitchingPersona) return;
      const localUID = String(client.uid);
      const transcriptText = formatTranscriptForHandoff(messageList, personaTimeline, localUID);
      const success = await onSwitchPersona(next, transcriptText);
      if (success) {
        setPersonaTimeline((prev) => [...prev, { persona: next, since: Date.now() }]);
      }
    },
    [client.uid, currentPersona, isSwitchingPersona, messageList, onSwitchPersona, personaTimeline],
  );

  const handleEndConversation = useCallback(async () => {
    const localUID = String(client.uid);
    const transcript: ReportTranscriptTurn[] = messageList
      .filter((message) => (message.text ?? '').trim().length > 0)
      .map((message) => ({
        persona: getPersonaAtTimestamp(personaTimeline, message.createdAt),
        speaker: String(message.uid) === localUID ? 'candidate' : 'panelist',
        text: (message.text ?? '').trim(),
      }));
    onEndConversation(transcript);
  }, [client.uid, messageList, personaTimeline, onEndConversation]);

  // "Latest" refs so the zero-crossing effect below can read fresh values without
  // listing them as dependencies. This matters: the persona-reset effect above
  // clears hasTriggeredZeroRef synchronously the instant currentPersona changes,
  // but its setRemainingSeconds call only applies on the *next* render. If the
  // zero-crossing effect also depended on currentPersona (or on
  // handleSwitchPersona/handleEndConversation, which are recreated whenever it
  // changes), it would re-run in that same commit and see the just-cleared ref
  // alongside the still-stale (previous persona's) remainingSeconds === 0 — firing
  // again immediately and skipping straight to the persona after next. Depending
  // only on remainingSeconds avoids that: this effect only re-runs once
  // remainingSeconds itself has actually changed.
  const activePersonasRef = useRef(activePersonas);
  activePersonasRef.current = activePersonas;
  const currentPersonaRef = useRef(currentPersona);
  currentPersonaRef.current = currentPersona;
  const handleSwitchPersonaRef = useRef(handleSwitchPersona);
  handleSwitchPersonaRef.current = handleSwitchPersona;
  const handleEndConversationRef = useRef(handleEndConversation);
  handleEndConversationRef.current = handleEndConversation;

  // Fires exactly once per persona when its timer reaches zero: hands off to the
  // next active persona (same path the old manual switch button used), or ends
  // the interview automatically when the last persona's time runs out.
  useEffect(() => {
    if (remainingSeconds !== 0 || hasTriggeredZeroRef.current) return;
    hasTriggeredZeroRef.current = true;

    const activePersonas = activePersonasRef.current;
    const currentIndex = activePersonas.indexOf(currentPersonaRef.current);
    const next = activePersonas[currentIndex + 1];
    if (next) {
      handleSwitchPersonaRef.current(next);
    } else {
      handleEndConversationRef.current();
    }
  }, [remainingSeconds]);

  return (
    <QuickstartConversationLayout
      statusPanel={
        <ConnectionStatusPanel
          connectionState={connectionState}
          connectionSeverity={connectionSeverity}
          connectionIssues={connectionIssues}
          isOpen={isConnectionDetailsOpen}
          onToggle={() => setIsConnectionDetailsOpen((open) => !open)}
        />
      }
      pipelineMetrics={<QuickstartPipelineMetrics metrics={agentMetrics} />}
      personaPanel={
        <PersonaSwitcher
          personas={activePersonas}
          current={currentPersona}
          remainingSeconds={remainingSeconds}
          isSwitching={isSwitchingPersona}
          error={switchError}
        />
      }
      transcriptPanel={
        <QuickstartTranscriptPanel
          messageList={messageList}
          currentInProgressMessage={currentInProgressMessage}
          agentUID={agentUID}
          personaTimeline={personaTimeline}
        />
      }
      visualizer={
        <div
          className="relative flex h-full min-h-[20rem] w-full max-w-4xl items-center justify-center"
          role="region"
          aria-label="AI agent status visualization"
        >
          <AgentVisualizer state={visualizerState} size="lg" />
          {remoteUsers.map((user) => (
            <div key={user.uid} className="hidden">
              <RemoteUser user={user} />
            </div>
          ))}
        </div>
      }
      controls={
        <div
          className="mx-auto flex w-fit items-center gap-3 rounded-full border border-border/60 bg-card/70 px-4 py-2 shadow-[0_10px_30px_-10px_rgba(74,74,74,0.3)] backdrop-blur-xl"
          role="group"
          aria-label="Audio controls"
        >
          <div className="conversation-mic-host flex items-center justify-center">
            <MicButtonWithVisualizer
              isEnabled={isEnabled}
              setIsEnabled={setIsEnabled}
              track={localMicrophoneTrack}
              onToggle={handleMicToggle}
              className="overflow-visible"
              aria-label={isEnabled ? 'Mute microphone' : 'Unmute microphone'}
              enabledColor="hsl(var(--primary))"
              disabledColor="hsl(var(--destructive))"
            />
          </div>
          <MicrophoneSelector localMicrophoneTrack={localMicrophoneTrack} />
        </div>
      }
      onEndConversation={handleEndConversation}
      codingPanel={
        showCodingPanel && codingQuestion ? (
          <CodingQuestionPanel
            question={codingQuestion}
            secondsRemaining={codingRemainingSeconds ?? codingPhaseSeconds}
          />
        ) : undefined
      }
    />
  );
}
