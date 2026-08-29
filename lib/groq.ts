import OpenAI from 'openai';

// Server-only: reads GROQ_API_KEY directly from process.env, never a NEXT_PUBLIC_ var.
// Never import this file from a 'use client' component.
function getGroqClient(): OpenAI | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
}

// Returns null on missing key or any request failure so every call site can
// fall back to its existing (pre-Groq) behavior without special-casing errors.
export async function groqRespond(input: string): Promise<string | null> {
  const client = getGroqClient();
  if (!client) return null;
  try {
    const response = await client.responses.create({
      model: 'openai/gpt-oss-20b',
      input,
    });
    return response.output_text ?? null;
  } catch (error) {
    console.error('[groq] request failed:', error);
    return null;
  }
}
