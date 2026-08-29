import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { candidateContext, reports, sessions } from '@/lib/db/schema';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, id));

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const [context] = await db
      .select()
      .from(candidateContext)
      .where(eq(candidateContext.sessionId, id));

    // A reports row is written once, at the end of the interview (see
    // POST /api/session/[id]/report) — its presence is a reliable, migration-free
    // signal that this link has already been used.
    const [existingReport] = await db.select().from(reports).where(eq(reports.sessionId, id));

    // recruiterEmail is only needed server-side (for the post-interview report
    // email) and is intentionally left out of the candidate-facing response.
    const { recruiterEmail: _recruiterEmail, ...clientSession } = session;

    return NextResponse.json({
      session: clientSession,
      context: context?.context ?? null,
      completed: Boolean(existingReport),
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    return NextResponse.json(
      { error: 'Failed to fetch session', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
