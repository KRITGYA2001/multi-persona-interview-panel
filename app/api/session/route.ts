import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { candidateContext, sessions } from '@/lib/db/schema';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_PERSONA_MINUTES = 5;
const MIN_PERSONA_MINUTES = 1;
const MAX_PERSONA_MINUTES = 30;

function generateChannelName(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `interview-${timestamp}-${random}`;
}

// Falls back to the default duration for any active persona missing a sane
// entry, rather than rejecting the request — mirrors how focusAreas/activePersonas
// already default instead of hard-failing.
function normalizePersonaDurations(
  raw: unknown,
  activePersonas: string[],
): Record<string, number> {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result: Record<string, number> = {};
  for (const id of activePersonas) {
    const value = source[id];
    result[id] =
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= MIN_PERSONA_MINUTES &&
      value <= MAX_PERSONA_MINUTES
        ? value
        : DEFAULT_PERSONA_MINUTES;
  }
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const roleTitle = typeof body.roleTitle === 'string' ? body.roleTitle.trim() : '';
    const focusAreas = Array.isArray(body.focusAreas) ? body.focusAreas : [];
    const activePersonas = Array.isArray(body.activePersonas)
      ? body.activePersonas
      : ['technical', 'product', 'behavioral'];
    const recruiterEmail = typeof body.recruiterEmail === 'string' ? body.recruiterEmail.trim() : '';
    const candidateName = typeof body.candidateName === 'string' ? body.candidateName.trim() : '';
    const personaDurations = normalizePersonaDurations(body.personaDurations, activePersonas);

    if (!roleTitle) {
      return NextResponse.json({ error: 'roleTitle is required' }, { status: 400 });
    }
    if (!recruiterEmail || !EMAIL_PATTERN.test(recruiterEmail)) {
      return NextResponse.json({ error: 'A valid recruiterEmail is required' }, { status: 400 });
    }
    if (!candidateName) {
      return NextResponse.json({ error: 'A candidate name is required' }, { status: 400 });
    }

    const [session] = await db
      .insert(sessions)
      .values({
        roleTitle,
        focusAreas,
        activePersonas,
        recruiterEmail,
        candidateName,
        personaDurations,
        channelName: generateChannelName(),
      })
      .returning();

    await db.insert(candidateContext).values({
      sessionId: session.id,
      context: {
        session_id: session.id,
        role_profile: { title: roleTitle, focus_areas: focusAreas },
        claims: [],
        contradictions: [],
        competency_scores: {},
        topics_covered: [],
        handoff_log: [],
      },
    });

    return NextResponse.json({ session });
  } catch (error) {
    console.error('Error creating session:', error);
    return NextResponse.json(
      { error: 'Failed to create session', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
