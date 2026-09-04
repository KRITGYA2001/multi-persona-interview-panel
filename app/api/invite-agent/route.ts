import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import {
  AgoraClient,
  Agent,
  Area,
  DeepgramSTT,
  ExpiresIn,
  MiniMaxTTS,
  OpenAI,
} from 'agora-agents';
import { ClientStartRequest, AgentResponse } from '@/types/conversation';
import { db } from '@/lib/db';
import { sessions, candidateContext } from '@/lib/db/schema';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import { groqRespond } from '@/lib/groq';
import {
  buildDebriefGreeting,
  buildDebriefSystemPrompt,
  buildPersonaGreeting,
  buildPersonaSystemPrompt,
  DEBRIEF_VOICE_ID,
  getPersonaDefinition,
  type PersonaId,
} from '@/lib/personas';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function POST(request: NextRequest) {
  try {
    // --- 1. Parse request ---

    const body: ClientStartRequest = await request.json();
    const { requester_id, channel_name, session_id, priorContext, fromPersona, debrief, debriefReport } = body;
    const personaId = (body.persona ?? 'technical') as PersonaId;

    // Validate required env vars on first request so misconfiguration surfaces
    // with a clear error message rather than a silent failure.
    const appId = requireEnv('NEXT_PUBLIC_AGORA_APP_ID');
    const appCertificate = requireEnv('NEXT_AGORA_APP_CERTIFICATE');

    if (!channel_name || !requester_id) {
      return NextResponse.json(
        { error: 'channel_name and requester_id are required' },
        { status: 400 },
      );
    }

    if (debrief && !debriefReport) {
      return NextResponse.json(
        { error: 'debriefReport is required when debrief is true' },
        { status: 400 },
      );
    }

    if (!debrief) {
      try {
        getPersonaDefinition(personaId);
      } catch {
        return NextResponse.json({ error: `Unknown persona: ${personaId}` }, { status: 400 });
      }
    }

    // Role/focus-area context comes from Postgres (source of truth, design.md §1),
    // not the client request, so the spoken system prompt can't drift from what
    // the recruiter configured at Setup.
    let roleTitle = 'this role';
    let focusAreas: string[] = [];
    let durationMinutes: number | undefined;
    if (session_id) {
      const [session] = await db.select().from(sessions).where(eq(sessions.id, session_id));
      if (session) {
        roleTitle = session.roleTitle;
        focusAreas = session.focusAreas;
        durationMinutes = session.personaDurations?.[personaId];
      }
    }

    // Upgrade the raw hand-off transcript into a Groq-generated summary before
    // injecting it into the next persona's prompt. Falls back to the raw
    // transcript unchanged (today's behavior) if GROQ_API_KEY is unset or the
    // call fails — a switch must never be blocked by a summarization error.
    let contextForPrompt = priorContext;
    if (!debrief && priorContext) {
      const summary = await groqRespond(
        `Summarize the following job-interview transcript in under 200 words. Preserve concrete facts the candidate stated (skills, experience, examples given) and note which topics have already been covered. Do not add commentary or evaluation — just summarize.\n\nTranscript:\n${priorContext}`,
      );
      if (summary) contextForPrompt = summary;
    }

    // The debrief agent isn't a panel persona — it gets its own prompt, greeting,
    // and voice, built from the just-generated feedback report (never the score:
    // debriefReport's type structurally excludes hiringScore, see lib/personas.ts).
    const systemPrompt = debrief
      ? buildDebriefSystemPrompt(roleTitle, {
          overallSummary: debriefReport!.overallSummary,
          focusAreaCoverage: debriefReport!.focusAreaCoverage,
          personas: debriefReport!.personas.map((p) => ({
            label: p.label,
            strengths: p.strengths,
            concerns: p.concerns,
            notableQuotes: p.notableQuotes,
          })),
        })
      : buildPersonaSystemPrompt(personaId, roleTitle, focusAreas, contextForPrompt, durationMinutes);

    // A mid-call switch should pick up the conversation, not re-introduce the panel from scratch.
    const greeting = debrief
      ? buildDebriefGreeting()
      : buildPersonaGreeting(personaId, roleTitle, Boolean(priorContext), fromPersona as PersonaId | undefined);

    const voiceId = debrief ? DEBRIEF_VOICE_ID : getPersonaDefinition(personaId).voiceId;

    // Always the same agentUid regardless of persona: only one panelist ever speaks at a time,
    // and RTC presence detection / transcript speaker-side rendering key off this constant
    // (see docs/ai/L1/L2/persona_handoff.md).
    const agentUid = String(DEFAULT_AGENT_UID);

    // --- 2. Build and start the agent ---

    // AgoraClient authenticates API calls to the Agora Conversational AI service.
    // area: change to Area.EU or Area.AP for European or Asia-Pacific deployments.
    const client = new AgoraClient({
      area: Area.US,
      appId,
      appCertificate,
    });

    // Pipeline: Deepgram (reseller) STT → OpenAI gpt-4o-mini (Agora-managed) LLM → MiniMax (reseller) TTS.
    const agent = new Agent({
      client,
      instructions: systemPrompt,
      greeting,
      failureMessage: 'Please wait a moment.',
      maxHistory: 50,
      // VAD controls how the agent detects the start and end of a user's turn.
      turnDetection: {
        config: {
          speech_threshold: 0.5,
          start_of_speech: {
            mode: 'vad',
            vad_config: {
              interrupt_duration_ms: 160, // ms of speech before interruption triggers
              prefix_padding_ms: 300, // audio captured before speech is detected
            },
          },
          end_of_speech: {
            mode: 'vad',
            vad_config: {
              silence_duration_ms: 480, // ms of silence before turn ends
            },
          },
        },
      },
      // RTM is required for transcript events in the browser client.
      // enable_tools is required for MCP tool invocation.
      advancedFeatures: { enable_rtm: true, enable_tools: true },
      // Required for browser RTM events:
      // - data_channel: 'rtm' enables RTM delivery path for state/metrics/errors
      // - enable_error_message emits AGENT_ERROR payloads
      // - enable_metrics emits AGENT_METRICS latency payloads
      parameters: {
        // web client → ultra-low-latency chorus profile
        audio_scenario: 'chorus',
        data_channel: 'rtm',
        enable_error_message: true,
        enable_metrics: true,
      },
    })
      .withStt(
        new DeepgramSTT({
          model: 'nova-3',
          language: 'en',
        }),
        // BYOK: uncomment the following block and set NEXT_DEEPGRAM_API_KEY
        // new DeepgramSTT({
        //   apiKey: requireEnv('NEXT_DEEPGRAM_API_KEY'),
        //   model: 'nova-3',
        //   language: 'en',
        // }),
      )
      .withLlm(
        // Agora-managed preset — no API key required, billed directly through Agora.
        new OpenAI({
          model: 'gpt-4o-mini',
          greetingMessage: greeting,
          failureMessage: 'Please wait a moment.',
          maxHistory: 15,
          maxTokens: 1024,
          temperature: 0.7,
          topP: 0.95,
        }),
        // BYOK — Anthropic Claude (set ANTHROPIC_API_KEY)
        // new (await import('agora-agents')).Anthropic({
        //   apiKey: requireEnv('ANTHROPIC_API_KEY'),
        //   model: 'claude-sonnet-4-5-20250929',
        //   url: 'https://api.anthropic.com/v1/messages',
        //   headers: { 'anthropic-version': '2023-06-01' },
        //   greetingMessage: greeting,
        //   failureMessage: 'Please wait a moment.',
        //   maxHistory: 15,
        //   maxTokens: 1024,
        //   temperature: 0.7,
        //   topP: 0.95,
        // }),
      )
      .withTts(
        new MiniMaxTTS({
          model: 'speech_2_6_turbo',
          voiceId,
        }),
        // BYOK — ElevenLabs (set NEXT_ELEVENLABS_API_KEY; optional NEXT_ELEVENLABS_VOICE_ID)
        // new (await import('agora-agents')).ElevenLabsTTS({
        //   key: requireEnv('NEXT_ELEVENLABS_API_KEY'),
        //   modelId: 'eleven_flash_v2_5',
        //   voiceId: process.env.NEXT_ELEVENLABS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB',
        //   sampleRate: 24000,
        // }),
      );

    // remoteUids restricts the agent to only process audio from this user
    const session = agent.createSession({
      channel: channel_name,
      agentUid,
      remoteUids: [requester_id],
      idleTimeout: 30,
      expiresIn: ExpiresIn.hours(1),
      debug: false, // enable debug to show restful API calls in the console
    });

    const agentId = await session.start();

    // Log the hand-off so the recruiter-facing context record reflects the
    // panel's actual path through the interview. Best-effort: a logging
    // failure shouldn't fail an otherwise-successful agent start.
    if (session_id && fromPersona) {
      try {
        const [existing] = await db
          .select()
          .from(candidateContext)
          .where(eq(candidateContext.sessionId, session_id));
        if (existing) {
          const context = existing.context as Record<string, unknown>;
          const handoffLog = Array.isArray(context.handoff_log) ? context.handoff_log : [];
          await db
            .update(candidateContext)
            .set({
              context: {
                ...context,
                handoff_log: [
                  ...handoffLog,
                  { from: fromPersona, to: personaId, at: new Date().toISOString() },
                ],
              },
              updatedAt: new Date(),
            })
            .where(eq(candidateContext.sessionId, session_id));
        }
      } catch (err) {
        console.error('Failed to log persona hand-off:', err);
      }
    }

    return NextResponse.json({
      agent_id: agentId,
      create_ts: Math.floor(Date.now() / 1000),
      state: 'RUNNING',
    } as AgentResponse);
  } catch (error) {
    console.error('Error starting conversation:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to start conversation',
      },
      { status: 500 },
    );
  }
}
