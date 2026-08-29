import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type {
  FeedbackReport,
  FeedbackReportPersonaSection,
  ReportTranscriptTurn,
} from '@/types/conversation';
import { PERSONA_IDS, getPersonaDefinition } from '@/lib/personas';
import { groqRespond } from '@/lib/groq';

const REPORT_SYSTEM_PROMPT =
  'You are an assistant that writes structured candidate feedback reports for a job interview panel. Respond with ONLY a JSON object matching this shape: {"overallSummary": string, "focusAreaCoverage": [{"focusArea": string, "covered": boolean}], "personas": [{"persona": string, "label": string, "strengths": string[], "concerns": string[], "notableQuotes": string[]}]}. Be specific and evidence-based, quoting the candidate where useful. Do not include markdown formatting or any text outside the JSON object.';

export type { ReportTranscriptTurn };

export interface BuildFeedbackReportInput {
  roleTitle: string;
  candidateName?: string;
  focusAreas: string[];
  transcript: ReportTranscriptTurn[];
}

type ReportDeps = {
  createOpenAIClient: typeof createOpenAI;
  generateTextImpl: typeof generateText;
};

// Deterministic, no-external-call report built purely from transcript stats.
// Used whenever the optional LLM env vars aren't set, and as a safety net if
// the LLM call itself fails — the candidate should never be left with no
// report at all.
function buildHeuristicReport(input: BuildFeedbackReportInput): FeedbackReport {
  const { roleTitle, candidateName, focusAreas, transcript } = input;

  const personas: FeedbackReportPersonaSection[] = PERSONA_IDS.filter((id) =>
    transcript.some((t) => t.persona === id),
  ).map((id) => {
    const def = getPersonaDefinition(id);
    const candidateTurns = transcript.filter(
      (t) => t.persona === id && t.speaker === 'candidate',
    );
    const wordCounts = candidateTurns.map((t) => t.text.trim().split(/\s+/).filter(Boolean).length);
    const totalWords = wordCounts.reduce((a, b) => a + b, 0);
    const avgWords = candidateTurns.length > 0 ? Math.round(totalWords / candidateTurns.length) : 0;

    const strengths: string[] = [];
    const concerns: string[] = [];

    if (candidateTurns.length === 0) {
      concerns.push(`No responses were recorded for the ${def.label} panelist.`);
    } else {
      if (avgWords >= 25) {
        strengths.push('Gave detailed, substantive answers to this panelist.');
      } else if (avgWords < 10) {
        concerns.push('Answers to this panelist were often brief — consider probing for more depth here.');
      }
      strengths.push(`Engaged in ${candidateTurns.length} exchange${candidateTurns.length === 1 ? '' : 's'} on ${def.focus}.`);
    }

    const notableQuotes = candidateTurns
      .slice()
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, 2)
      .map((t) => t.text);

    return { persona: id, label: def.label, strengths, concerns, notableQuotes };
  });

  const candidateText = transcript
    .filter((t) => t.speaker === 'candidate')
    .map((t) => t.text.toLowerCase())
    .join(' ');

  const focusAreaCoverage = focusAreas.map((focusArea) => ({
    focusArea,
    covered: focusArea
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .some((word) => candidateText.includes(word)),
  }));

  const totalCandidateTurns = transcript.filter((t) => t.speaker === 'candidate').length;
  const overallSummary =
    totalCandidateTurns > 0
      ? `The candidate completed a panel interview for the ${roleTitle} role across ${personas.length} panelist${personas.length === 1 ? '' : 's'}, with ${totalCandidateTurns} recorded response${totalCandidateTurns === 1 ? '' : 's'}. Review the per-panelist notes below for detail.`
      : `No candidate responses were recorded for this ${roleTitle} interview.`;

  return {
    roleTitle,
    candidateName,
    overallSummary,
    focusAreaCoverage,
    personas,
    source: 'heuristic',
    generatedAt: new Date().toISOString(),
  };
}

function formatTranscriptForPrompt(transcript: ReportTranscriptTurn[]): string {
  return transcript
    .map((t) => {
      const label = t.speaker === 'candidate' ? 'Candidate' : getPersonaDefinition(t.persona).label;
      return `[${label}]: ${t.text}`;
    })
    .join('\n');
}

function tryParseReportJson(text: string): Omit<FeedbackReport, 'roleTitle' | 'source' | 'generatedAt'> | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.personas) || !Array.isArray(parsed.focusAreaCoverage)) return null;
    if (typeof parsed.overallSummary !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

// Builds the same prompt content used by both the Groq path and the
// @ai-sdk/openai path, so a switch between them never changes report quality.
function buildReportUserPrompt(input: BuildFeedbackReportInput): string {
  return `Role: ${input.roleTitle}\nFocus areas: ${input.focusAreas.join(', ') || 'none specified'}\n\nTranscript:\n${formatTranscriptForPrompt(input.transcript)}`;
}

export function createFeedbackReportBuilder({ createOpenAIClient, generateTextImpl }: ReportDeps) {
  return async function buildFeedbackReport(
    input: BuildFeedbackReportInput,
  ): Promise<FeedbackReport> {
    // Try Groq first when configured — additive, never removes the existing
    // NEXT_LLM_API_KEY / heuristic fallback chain below.
    if (process.env.GROQ_API_KEY) {
      const groqText = await groqRespond(
        `${REPORT_SYSTEM_PROMPT}\n\n${buildReportUserPrompt(input)}`,
      );
      if (groqText) {
        const parsed = tryParseReportJson(groqText);
        if (parsed) {
          return {
            roleTitle: input.roleTitle,
            candidateName: input.candidateName,
            overallSummary: parsed.overallSummary,
            focusAreaCoverage: parsed.focusAreaCoverage,
            personas: parsed.personas,
            source: 'llm',
            generatedAt: new Date().toISOString(),
          };
        }
      }
    }

    const apiKey = process.env.NEXT_LLM_API_KEY;
    const llmUrl = process.env.NEXT_LLM_URL;

    if (!apiKey || !llmUrl) {
      return buildHeuristicReport(input);
    }

    try {
      const baseURL = llmUrl.replace(/\/chat\/completions\/?$/, '');
      const openai = createOpenAIClient({ apiKey, baseURL });

      const { text } = await generateTextImpl({
        model: openai('gpt-4o'),
        messages: [
          { role: 'system', content: REPORT_SYSTEM_PROMPT },
          { role: 'user', content: buildReportUserPrompt(input) },
        ],
      });

      const parsed = tryParseReportJson(text);
      if (!parsed) {
        return buildHeuristicReport(input);
      }

      return {
        roleTitle: input.roleTitle,
        candidateName: input.candidateName,
        overallSummary: parsed.overallSummary,
        focusAreaCoverage: parsed.focusAreaCoverage,
        personas: parsed.personas,
        source: 'llm',
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('LLM report generation failed, falling back to heuristic report:', error);
      return buildHeuristicReport(input);
    }
  };
}

export const buildFeedbackReport = createFeedbackReportBuilder({
  createOpenAIClient: createOpenAI,
  generateTextImpl: generateText,
});
