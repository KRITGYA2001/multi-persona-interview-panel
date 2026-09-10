'use client';

import { useState, Suspense, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { RTMClient } from 'agora-rtm';
import type {
  AgoraTokenData,
  ClientStartRequest,
  AgentResponse,
  AgoraRenewalTokens,
  DebriefReportPayload,
  FeedbackReport,
  ReportTranscriptTurn,
} from '@/types/conversation';
import type { CodingQuestion } from '@/lib/coding-question';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from './ErrorBoundary';
import { InterviewReport } from './InterviewReport';
import { LoadingSkeleton } from './LoadingSkeleton';
import { MicCheck } from './MicCheck';
import { PERSONA_IDS, type PersonaId } from '@/lib/personas';

const ConversationComponent = dynamic(() => import('./ConversationComponent'), {
  ssr: false,
});

const DebriefCall = dynamic(() => import('./DebriefCall'), {
  ssr: false,
});

const AgoraProvider = dynamic(() => import('./AgoraProvider'), {
  ssr: false,
});

interface SessionData {
  id: string;
  roleTitle: string;
  focusAreas: string[];
  activePersonas: string[];
  personaDurations: Record<string, number>;
  channelName: string;
  candidateName: string | null;
}

const DEFAULT_PERSONA_MINUTES = 5;

type Stage =
  | 'loading'
  | 'not-found'
  | 'completed'
  | 'mic-check'
  | 'conversation'
  | 'debrief-offer'
  | 'debrief'
  | 'report'
  | 'closed';

interface InterviewSessionProps {
  sessionId: string;
}

export default function InterviewSession({ sessionId }: InterviewSessionProps) {
  const [stage, setStage] = useState<Stage>('loading');
  const [session, setSession] = useState<SessionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agoraData, setAgoraData] = useState<AgoraTokenData | null>(null);
  const [rtmClient, setRtmClient] = useState<RTMClient | null>(null);
  const [agentJoinError, setAgentJoinError] = useState(false);
  const [currentPersona, setCurrentPersona] = useState<PersonaId>('technical');
  const [isSwitchingPersona, setIsSwitchingPersona] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [report, setReport] = useState<FeedbackReport | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState('');
  const [isStartingDebrief, setIsStartingDebrief] = useState(false);
  const [debriefError, setDebriefError] = useState<string | null>(null);
  const [codingQuestion, setCodingQuestion] = useState<CodingQuestion | undefined>(undefined);

  // Preload heavy modules while the candidate is still on the mic-check screen so
  // there's no dynamic-import delay once they click Continue.
  useEffect(() => {
    import('agora-rtc-react').catch(() => {});
    import('agora-rtm').catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}`);
        if (!res.ok) {
          if (!cancelled) setStage('not-found');
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setSession(data.session);
          setStage(data.completed ? 'completed' : 'mic-check');
        }
      } catch {
        if (!cancelled) setStage('not-found');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const startConversation = useCallback(async (name: string) => {
    if (!session) return;
    setCandidateName(name);
    setIsLoading(true);
    setError(null);
    setAgentJoinError(false);

    try {
      const agoraResponse = await fetch(
        `/api/generate-agora-token?channel=${encodeURIComponent(session.channelName)}`,
      );
      const responseData = await agoraResponse.json();

      if (!agoraResponse.ok) {
        throw new Error(
          `Failed to generate Agora token: ${JSON.stringify(responseData)}`,
        );
      }

      const persona: PersonaId = PERSONA_IDS.find((id) =>
        session.activePersonas.includes(id),
      ) ?? 'technical';
      setCurrentPersona(persona);

      const [agentData, rtm] = await Promise.all([
        fetch('/api/invite-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requester_id: responseData.uid,
            channel_name: responseData.channel,
            persona,
            session_id: session.id,
          } as ClientStartRequest),
        })
          .then(async (res) => {
            if (!res.ok) {
              setAgentJoinError(true);
              return null;
            }
            return res.json() as Promise<AgentResponse>;
          })
          .catch((err) => {
            console.error('Failed to start conversation with agent:', err);
            setAgentJoinError(true);
            return null;
          }),

        (async () => {
          const { default: AgoraRTM } = await import('agora-rtm');
          const rtm: RTMClient = new AgoraRTM.RTM(
            process.env.NEXT_PUBLIC_AGORA_APP_ID!,
            responseData.uid,
          );
          await rtm.login({ token: responseData.token });
          await rtm.subscribe(responseData.channel);
          return rtm;
        })(),
      ]);

      if (agentData?.codingQuestion) setCodingQuestion(agentData.codingQuestion);
      setRtmClient(rtm);
      setAgoraData({ ...responseData, agentId: agentData?.agent_id });
      setStage('conversation');
    } catch (err) {
      setError('Failed to start conversation. Please try again.');
      console.error('Error starting conversation:', err);
      // Send the candidate back to the mic-check screen rather than stranding
      // them on a broken conversation stage with no way forward.
      setStage('mic-check');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  const handleTokenWillExpire = useCallback(
    async (uid: string): Promise<AgoraRenewalTokens> => {
      try {
        const channel = agoraData?.channel;
        if (!channel) {
          throw new Error('Missing channel for token renewal');
        }

        const [rtcResponse, rtmResponse] = await Promise.all([
          fetch(`/api/generate-agora-token?channel=${channel}&uid=${uid}`),
          fetch(`/api/generate-agora-token?channel=${channel}&uid=${agoraData.uid}`),
        ]);
        const [rtcData, rtmData] = await Promise.all([
          rtcResponse.json(),
          rtmResponse.json(),
        ]);

        if (!rtcResponse.ok || !rtmResponse.ok) {
          throw new Error('Failed to generate renewal tokens');
        }

        return {
          rtcToken: rtcData.token,
          rtmToken: rtmData.token,
        };
      } catch (error) {
        console.error('Error renewing token:', error);
        throw error;
      }
    },
    [agoraData],
  );

  // Persona switch = stop the running agent and start a new one on the same fixed
  // agentUID/channel/RTC connection (see docs/ai/L1/L2/persona_handoff.md). The
  // hand-off transcript is injected into the new persona's system prompt so it
  // picks up naturally instead of re-introducing the panel from scratch.
  const handleSwitchPersona = useCallback(
    async (next: PersonaId, transcriptText: string): Promise<boolean> => {
      if (!session || !agoraData) return false;
      setIsSwitchingPersona(true);
      setSwitchError(null);

      try {
        if (agoraData.agentId) {
          const stopResponse = await fetch('/api/stop-conversation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agoraData.agentId }),
          });
          if (!stopResponse.ok) {
            console.error(
              'Failed to stop previous agent during persona switch:',
              await stopResponse.text(),
            );
          }
        }

        const inviteResponse = await fetch('/api/invite-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requester_id: agoraData.uid,
            channel_name: agoraData.channel,
            persona: next,
            session_id: session.id,
            priorContext: transcriptText,
            fromPersona: currentPersona,
          } as ClientStartRequest),
        });

        if (!inviteResponse.ok) {
          throw new Error(`Failed to start new panelist: ${await inviteResponse.text()}`);
        }

        const agentData = (await inviteResponse.json()) as AgentResponse;
        if (agentData.codingQuestion) setCodingQuestion(agentData.codingQuestion);
        setAgoraData((prev) => (prev ? { ...prev, agentId: agentData.agent_id } : prev));
        setCurrentPersona(next);
        return true;
      } catch (err) {
        console.error('Error switching persona:', err);
        setSwitchError('Failed to switch panelist. Please try again.');
        return false;
      } finally {
        setIsSwitchingPersona(false);
      }
    },
    [session, agoraData, currentPersona],
  );

  // Stops the current panelist's agent but keeps RTC/RTM alive through report
  // generation, so a "yes" on the debrief offer can start one more agent
  // session on the same connection instead of rejoining from scratch.
  const handleEndConversation = useCallback(
    async (transcript: ReportTranscriptTurn[]) => {
      if (agoraData?.agentId) {
        try {
          const response = await fetch('/api/stop-conversation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agoraData.agentId }),
          });
          if (!response.ok) {
            console.error('Failed to stop agent:', await response.text());
          }
        } catch (error) {
          console.error('Error stopping agent:', error);
        }
      }

      if (!session || transcript.length === 0) {
        rtmClient?.logout().catch((err) => console.error('RTM logout error:', err));
        setRtmClient(null);
        setAgoraData(null);
        setStage('mic-check');
        return;
      }

      setStage('debrief-offer');
      setIsGeneratingReport(true);
      setReportError(null);
      try {
        const res = await fetch(`/api/session/${session.id}/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, candidateName }),
        });
        if (!res.ok) {
          throw new Error(`Failed to generate report: ${await res.text()}`);
        }
        const data = await res.json();
        setReport(data.report as FeedbackReport);
      } catch (err) {
        console.error('Error generating report:', err);
        setReportError('Failed to generate your feedback report.');
      } finally {
        setIsGeneratingReport(false);
      }
    },
    [agoraData, rtmClient, session, candidateName],
  );

  // "Talk to the panel" invites a debrief agent on the same fixed agentUid/RTC
  // connection the interview just used (see docs/ai/L1/L2/persona_handoff.md) —
  // never the hiringScore, which DebriefReportPayload structurally excludes.
  const handleTalkToPanel = useCallback(async () => {
    if (!session || !agoraData || !report) return;
    setIsStartingDebrief(true);
    setDebriefError(null);
    try {
      const debriefReport: DebriefReportPayload = {
        overallSummary: report.overallSummary,
        focusAreaCoverage: report.focusAreaCoverage,
        personas: report.personas,
      };
      const res = await fetch('/api/invite-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_id: agoraData.uid,
          channel_name: agoraData.channel,
          session_id: session.id,
          debrief: true,
          debriefReport,
        } as ClientStartRequest),
      });
      if (!res.ok) {
        throw new Error(`Failed to start debrief: ${await res.text()}`);
      }
      const agentData = (await res.json()) as AgentResponse;
      setAgoraData((prev) => (prev ? { ...prev, agentId: agentData.agent_id } : prev));
      setStage('debrief');
    } catch (err) {
      console.error('Error starting debrief:', err);
      setDebriefError('Failed to connect to the panel. You can still view your written report.');
    } finally {
      setIsStartingDebrief(false);
    }
  }, [session, agoraData, report]);

  const handleSkipDebrief = useCallback(() => {
    rtmClient?.logout().catch((err) => console.error('RTM logout error:', err));
    setRtmClient(null);
    setAgoraData(null);
    setStage('report');
  }, [rtmClient]);

  const handleEndDebrief = useCallback(async () => {
    if (agoraData?.agentId) {
      try {
        const response = await fetch('/api/stop-conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agoraData.agentId }),
        });
        if (!response.ok) {
          console.error('Failed to stop debrief agent:', await response.text());
        }
      } catch (error) {
        console.error('Error stopping debrief agent:', error);
      }
    }
    rtmClient?.logout().catch((err) => console.error('RTM logout error:', err));
    setRtmClient(null);
    setAgoraData(null);
    setStage('report');
  }, [agoraData, rtmClient]);

  // The interview link is one-time-use — a completed report already exists server-side
  // by the time the candidate reaches this screen, so there's nothing to go "back" to.
  // window.close() only works on tabs opened via script, so a direct-navigation tab
  // (the common case for an emailed/shared interview link) can't be force-closed; the
  // 'closed' stage's copy covers that fallback.
  const handleReportDone = useCallback(() => {
    setReport(null);
    setReportError(null);
    setStage('closed');
    window.close();
  }, []);

  // Converts the recruiter's per-persona minute budgets (from session setup) into
  // seconds for ConversationComponent's countdown; falls back to the default for
  // any persona missing an entry, which covers sessions created before this field existed.
  const personaDurationsSeconds = useMemo(() => {
    const seconds: Record<PersonaId, number> = {} as Record<PersonaId, number>;
    for (const id of PERSONA_IDS) {
      const minutes = session?.personaDurations?.[id] ?? DEFAULT_PERSONA_MINUTES;
      seconds[id] = minutes * 60;
    }
    return seconds;
  }, [session]);

  return (
    <div
      className={`relative flex flex-col text-foreground ${
        stage === 'conversation' || stage === 'debrief'
          ? 'h-dvh overflow-hidden'
          : 'min-h-dvh overflow-y-auto py-8'
      }`}
    >
      <div
        className={`flex min-h-0 flex-1 flex-col ${
          stage === 'conversation' || stage === 'debrief'
            ? 'items-stretch justify-start'
            : 'items-center justify-center'
        }`}
      >
        <div
          className={`z-10 flex min-h-0 flex-1 flex-col ${
            stage === 'conversation' || stage === 'debrief'
              ? 'h-full w-full max-w-none items-stretch gap-0 px-0 text-left'
              : 'w-full max-w-none items-center justify-center px-4 text-center'
          }`}
        >
          {stage === 'loading' && (
            <p className="text-sm text-muted-foreground">Loading interview...</p>
          )}

          {stage === 'not-found' && (
            <p className="text-sm text-muted-foreground">
              This interview link is invalid or has expired.
            </p>
          )}

          {stage === 'completed' && (
            <p className="text-sm text-muted-foreground">
              This interview has already been completed. This link can only be used once.
            </p>
          )}

          {stage === 'closed' && (
            <p className="text-sm text-muted-foreground">
              Thanks for completing your interview! You may now close this tab.
            </p>
          )}

          {stage === 'mic-check' && (
            <div className="flex w-full flex-col items-center gap-4">
              <MicCheck onConfirm={startConversation} expectedName={session?.candidateName ?? ''} />
              {isLoading && (
                <p className="text-xs text-muted-foreground">Connecting you to the panel...</p>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}

          {stage === 'conversation' &&
            (agoraData && rtmClient ? (
              <>
                {agentJoinError && (
                  <div className="max-w-sm rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive backdrop-blur-sm">
                    Failed to connect with AI agent. The conversation may not work
                    as expected.
                  </div>
                )}
                <Suspense fallback={<LoadingSkeleton />}>
                  <ErrorBoundary>
                    <AgoraProvider>
                      <ConversationComponent
                        agoraData={agoraData}
                        rtmClient={rtmClient}
                        onTokenWillExpire={handleTokenWillExpire}
                        onEndConversation={handleEndConversation}
                        currentPersona={currentPersona}
                        activePersonas={PERSONA_IDS.filter((id) =>
                          session?.activePersonas.includes(id),
                        )}
                        personaDurationsSeconds={personaDurationsSeconds}
                        isSwitchingPersona={isSwitchingPersona}
                        switchError={switchError}
                        onSwitchPersona={handleSwitchPersona}
                        codingQuestion={codingQuestion}
                      />
                    </AgoraProvider>
                  </ErrorBoundary>
                </Suspense>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Failed to load conversation data.
              </p>
            ))}

          {stage === 'debrief-offer' && (
            <div className="flex w-full max-w-lg animate-fade-up flex-col items-center gap-4 rounded-[28px] border border-border/60 bg-card/80 px-8 py-10 text-center shadow-[0_20px_60px_-15px_rgba(74,74,74,0.28)] backdrop-blur-xl">
              {isGeneratingReport ? (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-secondary/20">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                  <p className="text-sm text-muted-foreground">Preparing your feedback...</p>
                </>
              ) : (
                <>
                  <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
                    Your feedback is ready
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Want to talk it through with the panel, or go straight to your written report?
                  </p>
                  {debriefError && <p className="text-xs text-destructive">{debriefError}</p>}
                  <div className="flex w-full flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
                    <Button
                      onClick={handleTalkToPanel}
                      disabled={isStartingDebrief || !report}
                      className="rounded-xl bg-gradient-to-r from-primary to-secondary text-primary-foreground shadow-[0_8px_20px_-6px_rgba(226,180,189,0.6)] hover:from-primary/90 hover:to-secondary/90"
                    >
                      {isStartingDebrief ? 'Connecting...' : 'Talk to the panel about it'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleSkipDebrief}
                      disabled={isStartingDebrief}
                      className="rounded-xl"
                    >
                      Skip to my written report
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {stage === 'debrief' &&
            (agoraData && rtmClient ? (
              <Suspense fallback={<LoadingSkeleton />}>
                <ErrorBoundary>
                  <AgoraProvider>
                    <DebriefCall
                      agoraData={agoraData}
                      rtmClient={rtmClient}
                      onTokenWillExpire={handleTokenWillExpire}
                      onEndDebrief={handleEndDebrief}
                    />
                  </AgoraProvider>
                </ErrorBoundary>
              </Suspense>
            ) : (
              <p className="text-sm text-muted-foreground">Failed to load the debrief.</p>
            ))}

          {stage === 'report' && (
            <InterviewReport
              report={report}
              isLoading={isGeneratingReport}
              error={reportError}
              onDone={handleReportDone}
            />
          )}
        </div>
      </div>
    </div>
  );
}
