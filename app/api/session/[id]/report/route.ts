import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { reports, sessions, candidateContext } from '@/lib/db/schema';
import { buildFeedbackReport, type ReportTranscriptTurn } from '@/lib/report';
import { sendRecruiterReportEmail } from '@/lib/mailer';
import type { FeedbackReport } from '@/types/conversation';

interface ReportRequestBody {
  transcript?: ReportTranscriptTurn[];
  candidateName?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body: ReportRequestBody = await request.json();
    const transcript = Array.isArray(body.transcript) ? body.transcript : [];
    const candidateName = typeof body.candidateName === 'string' && body.candidateName.trim()
      ? body.candidateName.trim()
      : undefined;

    if (transcript.length === 0) {
      return NextResponse.json(
        { error: 'transcript is required and must be non-empty' },
        { status: 400 },
      );
    }

    const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const [existingReport] = await db.select().from(reports).where(eq(reports.sessionId, id));

    const [existingContext] = await db
      .select()
      .from(candidateContext)
      .where(eq(candidateContext.sessionId, id));
    const context = existingContext?.context as Record<string, unknown> | undefined;
    const codingQuestion = context?.coding_question as
      | { question: string; testExamples: { input: string; output: string }[] }
      | undefined;
    const codingExercise = codingQuestion
      ? { question: codingQuestion.question, testExamples: codingQuestion.testExamples }
      : undefined;

    const report = await buildFeedbackReport({
      roleTitle: session.roleTitle,
      candidateName,
      focusAreas: session.focusAreas,
      transcript,
      codingExercise,
    });

    await db
      .insert(reports)
      .values({ sessionId: id, report: report as unknown as object })
      .onConflictDoUpdate({
        target: reports.sessionId,
        set: { report: report as unknown as object, createdAt: new Date() },
      });

    // Only email the recruiter on the first report for this session — a
    // regeneration/retry should not send a second email. Best-effort: a
    // send failure never affects the response the candidate is waiting on.
    if (!existingReport && session.recruiterEmail) {
      sendRecruiterReportEmail(session.recruiterEmail, report).catch((error) => {
        console.error('Error sending recruiter report email:', error);
      });
    }

    return NextResponse.json({ report } satisfies { report: FeedbackReport });
  } catch (error) {
    console.error('Error generating report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const [existing] = await db.select().from(reports).where(eq(reports.sessionId, id));
    if (!existing) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    return NextResponse.json({ report: existing.report as FeedbackReport });
  } catch (error) {
    console.error('Error fetching report:', error);
    return NextResponse.json(
      { error: 'Failed to fetch report', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
