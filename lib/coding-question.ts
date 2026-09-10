import { groqRespond } from '@/lib/groq';

export interface CodingQuestion {
  question: string;
  testExamples: { input: string; output: string }[];
}

// Easy, well-known problems — used whenever GROQ_API_KEY is unset or the LLM
// call/parse fails, so the coding round never blocks on a missing key.
const FALLBACK_CODING_QUESTIONS: CodingQuestion[] = [
  {
    question:
      'Given an array of integers and a target number, return the indices of the two numbers that add up to the target. You can assume exactly one solution exists.',
    testExamples: [
      { input: 'nums = [2, 7, 11, 15], target = 9', output: '[0, 1]' },
      { input: 'nums = [3, 2, 4], target = 6', output: '[1, 2]' },
    ],
  },
  {
    question: 'Write a function that reverses a string in place.',
    testExamples: [
      { input: '"hello"', output: '"olleh"' },
      { input: '"a"', output: '"a"' },
    ],
  },
  {
    question:
      "Given a string containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string has valid, properly nested brackets.",
    testExamples: [
      { input: '"()[]{}"', output: 'true' },
      { input: '"(]"', output: 'false' },
    ],
  },
  {
    question:
      'Write a function that takes an integer n and returns an array of strings from 1 to n, but replaces multiples of 3 with "Fizz", multiples of 5 with "Buzz", and multiples of both with "FizzBuzz".',
    testExamples: [
      { input: 'n = 5', output: '["1", "2", "Fizz", "4", "Buzz"]' },
      { input: 'n = 3', output: '["1", "2", "Fizz"]' },
    ],
  },
  {
    question:
      'Given an array of integers, find the contiguous subarray (containing at least one number) with the largest sum, and return that sum.',
    testExamples: [
      { input: 'nums = [-2, 1, -3, 4, -1, 2, 1, -5, 4]', output: '6 (from [4, -1, 2, 1])' },
      { input: 'nums = [1]', output: '1' },
    ],
  },
];

function pickFallback(roleTitle: string): CodingQuestion {
  let hash = 0;
  for (let i = 0; i < roleTitle.length; i++) {
    hash = (hash * 31 + roleTitle.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_CODING_QUESTIONS[hash % FALLBACK_CODING_QUESTIONS.length];
}

function tryParseCodingQuestion(text: string): CodingQuestion | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.question !== 'string' || !parsed.question.trim()) return null;
    if (!Array.isArray(parsed.testExamples)) return null;
    const testExamples = parsed.testExamples.filter(
      (e: unknown): e is { input: string; output: string } =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as Record<string, unknown>).input === 'string' &&
        typeof (e as Record<string, unknown>).output === 'string',
    );
    if (testExamples.length === 0) return null;
    return { question: parsed.question, testExamples };
  } catch {
    return null;
  }
}

// Generates one easy-level coding question tailored to the role/focus areas.
// Falls back to a deterministic pick from FALLBACK_CODING_QUESTIONS whenever
// GROQ_API_KEY is unset or the call/parse fails — this must never block or
// fail agent startup.
export async function generateCodingQuestion(
  roleTitle: string,
  focusAreas: string[],
): Promise<CodingQuestion> {
  const groqText = await groqRespond(
    `You are writing one EASY-level coding interview question for a candidate interviewing for a "${roleTitle}" role, with a technical focus on: ${focusAreas.join(', ') || 'general programming'}. Respond with ONLY a JSON object of this exact shape: {"question": string, "testExamples": [{"input": string, "output": string}]}. Include 2 short test examples. The question should be solvable in a plain text box in under 10 minutes by someone comfortable with basic data structures and algorithms. Do not include markdown formatting or any text outside the JSON object.`,
  );
  if (groqText) {
    const parsed = tryParseCodingQuestion(groqText);
    if (parsed) return parsed;
  }
  return pickFallback(roleTitle);
}
