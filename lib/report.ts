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
  'You are an assistant that writes structured candidate feedback reports for a job interview panel. Respond with ONLY a JSON object matching this shape: {"overallSummary": string, "focusAreaCoverage": [{"focusArea": string, "covered": boolean}], "personas": [{"persona": string, "label": string, "strengths": string[], "concerns": string[], "notableQuotes": string[]}], "hiringScore": number}. "hiringScore" is your overall assessment of how likely this candidate should be hired for this specific role, on a 0-100 scale (0 = clear no-hire, 100 = clear strong hire), weighing all panelists\' findings together. Be specific and evidence-based, quoting the candidate where useful. If a coding exercise is included, it was a spoken round with no code editor — fold an assessment of the candidate\'s verbally described approach (correctness, reasoning, clarity) into the Technical panelist\'s strengths/concerns rather than giving it its own section. Do not include markdown formatting or any text outside the JSON object.';

export type { ReportTranscriptTurn };

export interface BuildFeedbackReportInput {
  roleTitle: string;
  candidateName?: string;
  focusAreas: string[];
  /** Which persona owns each focus area (session.personaFocusAreas) — lets the
   *  heuristic fallback judge coverage from actual persona engagement instead
   *  of literal keyword matching against free-form spoken language. */
  personaFocusAreas?: Record<string, string[]>;
  transcript: ReportTranscriptTurn[];
  codingExercise?: {
    question: string;
    testExamples: { input: string; output: string }[];
  };
}

type ReportDeps = {
  createOpenAIClient: typeof createOpenAI;
  generateTextImpl: typeof generateText;
};

function clampScore(score: unknown): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Deterministic fallback score used for the heuristic report path, and whenever
// an LLM response omits or returns an invalid hiringScore.
function computeHeuristicScore(
  personas: FeedbackReportPersonaSection[],
  focusAreaCoverage: { focusArea: string; covered: boolean }[],
  totalCandidateTurns: number,
): number {
  if (totalCandidateTurns === 0) return 0;

  const totalStrengths = personas.reduce((sum, p) => sum + p.strengths.length, 0);
  const totalConcerns = personas.reduce((sum, p) => sum + p.concerns.length, 0);
  const signalScore = totalStrengths - totalConcerns * 1.5;

  const coverageRatio =
    focusAreaCoverage.length > 0
      ? focusAreaCoverage.filter((f) => f.covered).length / focusAreaCoverage.length
      : 0.5;

  return clampScore(45 + signalScore * 8 + coverageRatio * 25) ?? 0;
}

function sanitizeHiringScore(
  candidate: unknown,
  personas: FeedbackReportPersonaSection[],
  focusAreaCoverage: { focusArea: string; covered: boolean }[],
  totalCandidateTurns: number,
): number {
  return clampScore(candidate) ?? computeHeuristicScore(personas, focusAreaCoverage, totalCandidateTurns);
}

// Deterministic, no-external-call report built purely from transcript stats.
// Used whenever the optional LLM env vars aren't set, and as a safety net if
// the LLM call itself fails — the candidate should never be left with no
// report at all.
function buildHeuristicReport(input: BuildFeedbackReportInput): FeedbackReport {
  const { roleTitle, candidateName, focusAreas, personaFocusAreas, transcript, codingExercise } = input;

  const candidateTurnsByPersona = new Map<string, ReportTranscriptTurn[]>();

  const personas: FeedbackReportPersonaSection[] = PERSONA_IDS.filter((id) =>
    transcript.some((t) => t.persona === id),
  ).map((id) => {
    const def = getPersonaDefinition(id);
    const candidateTurns = transcript.filter(
      (t) => t.persona === id && t.speaker === 'candidate',
    );
    candidateTurnsByPersona.set(id, candidateTurns);
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

    if (id === 'technical' && codingExercise) {
      strengths.push('Talked through a live coding question during this round — see transcript for their reasoning and solution.');
    }

    const notableQuotes = candidateTurns
      .slice()
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, 2)
      .map((t) => t.text);

    return { persona: id, label: def.label, strengths, concerns, notableQuotes };
  });

  // Which persona owns each focus area, so coverage can be judged from actual
  // candidate engagement with that panelist rather than fragile keyword
  // matching against free-form spoken language (candidates virtually never
  // say a focus-area's exact label out loud).
  const ownerByFocusArea = new Map<string, string>();
  if (personaFocusAreas) {
    for (const [personaId, areas] of Object.entries(personaFocusAreas)) {
      for (const area of areas) ownerByFocusArea.set(area, personaId);
    }
  }

  const candidateText = transcript
    .filter((t) => t.speaker === 'candidate')
    .map((t) => t.text.toLowerCase())
    .join(' ');

  const focusAreaCoverage = focusAreas.map((focusArea) => {
    const ownerPersona = ownerByFocusArea.get(focusArea);
    if (ownerPersona) {
      const ownerTurns = candidateTurnsByPersona.get(ownerPersona) ?? [];
      return { focusArea, covered: ownerTurns.length > 0 };
    }
    // No persona mapping available — fall back to keyword matching.
    return {
      focusArea,
      covered: focusArea
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .some((word) => candidateText.includes(word)),
    };
  });

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
    hiringScore: computeHeuristicScore(personas, focusAreaCoverage, totalCandidateTurns),
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

function tryParseReportJson(
  text: string,
): Omit<FeedbackReport, 'roleTitle' | 'source' | 'generatedAt' | 'hiringScore'> & { hiringScore?: unknown } | null {
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
  const codingSection = input.codingExercise
    ? `\n\nCoding exercise given to the candidate (this was a spoken round — no code editor; the candidate talked through their solution instead of typing it, so look at the transcript above for their reasoning and approach):\n${input.codingExercise.question}\nTest examples:\n${input.codingExercise.testExamples.map((e) => `Input: ${e.input} -> Output: ${e.output}`).join('\n')}`
    : '';
  return `Role: ${input.roleTitle}\nFocus areas: ${input.focusAreas.join(', ') || 'none specified'}\n\nTranscript:\n${formatTranscriptForPrompt(input.transcript)}${codingSection}`;
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
          const totalCandidateTurns = input.transcript.filter((t) => t.speaker === 'candidate').length;
          return {
            roleTitle: input.roleTitle,
            candidateName: input.candidateName,
            overallSummary: parsed.overallSummary,
            focusAreaCoverage: parsed.focusAreaCoverage,
            personas: parsed.personas,
            hiringScore: sanitizeHiringScore(
              parsed.hiringScore,
              parsed.personas,
              parsed.focusAreaCoverage,
              totalCandidateTurns,
            ),
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

      const totalCandidateTurns = input.transcript.filter((t) => t.speaker === 'candidate').length;
      return {
        roleTitle: input.roleTitle,
        candidateName: input.candidateName,
        overallSummary: parsed.overallSummary,
        focusAreaCoverage: parsed.focusAreaCoverage,
        personas: parsed.personas,
        hiringScore: sanitizeHiringScore(
          parsed.hiringScore,
          parsed.personas,
          parsed.focusAreaCoverage,
          totalCandidateTurns,
        ),
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
