'use client';

import { Loader2 } from 'lucide-react';
import type { FeedbackReport } from '@/types/conversation';
import { Button } from '@/components/ui/button';

interface InterviewReportProps {
  report: FeedbackReport | null;
  isLoading: boolean;
  error: string | null;
  onDone: () => void;
}

export function InterviewReport({ report, isLoading, error, onDone }: InterviewReportProps) {
  if (isLoading) {
    return (
      <div className="flex w-full max-w-lg animate-fade-up flex-col items-center gap-4 rounded-[28px] border border-border/60 bg-card/80 px-8 py-10 text-center shadow-[0_20px_60px_-15px_rgba(74,74,74,0.28)] backdrop-blur-xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-secondary/20">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">Preparing your feedback report...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex w-full max-w-lg animate-fade-up flex-col items-center gap-4 rounded-[28px] border border-border/60 bg-card/80 px-8 py-10 text-center shadow-[0_20px_60px_-15px_rgba(74,74,74,0.28)] backdrop-blur-xl">
        <p className="text-sm text-destructive">
          {error ?? 'No report is available for this interview.'}
        </p>
        <Button
          onClick={onDone}
          className="rounded-xl bg-gradient-to-r from-primary to-secondary text-primary-foreground shadow-[0_8px_20px_-6px_rgba(226,180,189,0.6)] hover:from-primary/90 hover:to-secondary/90"
        >
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-2xl animate-fade-up flex-col gap-6 rounded-[28px] border border-border/60 bg-card/80 px-6 py-8 text-left shadow-[0_20px_60px_-15px_rgba(74,74,74,0.28)] backdrop-blur-xl sm:px-10">
      <div className="flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-gradient-to-r from-primary/15 to-secondary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          Interview Feedback
        </span>
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">{report.roleTitle}</h1>
        {report.candidateName && (
          <p className="text-sm font-medium text-foreground">Candidate: {report.candidateName}</p>
        )}
        <p className="text-sm leading-6 text-muted-foreground">{report.overallSummary}</p>
      </div>

      {report.focusAreaCoverage.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-muted/30 p-5 backdrop-blur-sm">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Focus Areas</h2>
          <ul className="flex flex-col gap-2">
            {report.focusAreaCoverage.map((item) => (
              <li key={item.focusArea} className="flex items-center gap-2.5 text-sm">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs shadow-sm ${
                    item.covered
                      ? 'bg-gradient-to-br from-primary to-secondary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  aria-hidden
                >
                  {item.covered ? '✓' : '–'}
                </span>
                <span className="text-foreground">{item.focusArea}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {report.personas.map((persona) => (
          <div
            key={persona.persona}
            className="rounded-2xl border border-border/60 bg-muted/30 p-5 backdrop-blur-sm"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-secondary/25 text-xs font-semibold text-primary">
                {persona.label.slice(0, 1)}
              </span>
              <h2 className="text-sm font-semibold text-foreground">{persona.label} Panelist</h2>
            </div>

            {persona.strengths.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Strengths
                </p>
                <ul className="mt-1.5 list-disc pl-4 text-sm text-foreground marker:text-primary">
                  {persona.strengths.map((strength, i) => (
                    <li key={i}>{strength}</li>
                  ))}
                </ul>
              </div>
            )}

            {persona.concerns.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Areas to Improve
                </p>
                <ul className="mt-1.5 list-disc pl-4 text-sm text-foreground marker:text-secondary">
                  {persona.concerns.map((concern, i) => (
                    <li key={i}>{concern}</li>
                  ))}
                </ul>
              </div>
            )}

            {persona.notableQuotes.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Notable Quotes
                </p>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {persona.notableQuotes.map((quote, i) => (
                    <li
                      key={i}
                      className="rounded-lg border-l-2 border-primary/40 bg-card/60 py-1 pl-3 text-sm italic text-muted-foreground"
                    >
                      &ldquo;{quote}&rdquo;
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {report.source === 'llm'
          ? 'Generated by AI review of your interview.'
          : 'Generated from your interview transcript.'}
      </p>

      <Button
        onClick={onDone}
        className="self-start rounded-xl bg-gradient-to-r from-primary to-secondary text-primary-foreground shadow-[0_8px_20px_-6px_rgba(226,180,189,0.6)] hover:from-primary/90 hover:to-secondary/90"
      >
        Done
      </Button>
    </div>
  );
}
