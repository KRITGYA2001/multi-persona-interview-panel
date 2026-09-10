'use client';

import type { CodingQuestion } from '@/lib/coding-question';

interface CodingQuestionPanelProps {
  question: CodingQuestion;
  secondsRemaining: number;
}

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function CodingQuestionPanel({
  question,
  secondsRemaining,
}: CodingQuestionPanelProps) {
  return (
    <div
      className="flex min-h-0 flex-col gap-3 rounded-xl border border-border/60 bg-card/40 p-4 backdrop-blur-md"
      role="region"
      aria-label="Coding question"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Coding question
        </span>
        <span
          className={
            secondsRemaining <= 30
              ? 'shrink-0 animate-pulse rounded-full border border-destructive/60 bg-destructive/10 px-2.5 py-0.5 font-mono text-xs tabular-nums text-destructive'
              : 'shrink-0 rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5 font-mono text-xs tabular-nums text-muted-foreground'
          }
          aria-label={`${formatCountdown(secondsRemaining)} remaining`}
        >
          {formatCountdown(secondsRemaining)}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-foreground">{question.question}</p>

      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {question.testExamples.map((example, index) => (
          <li key={index} className="font-mono">
            <span className="text-muted-foreground/80">Input:</span> {example.input}{' '}
            <span className="text-muted-foreground/80">→ Output:</span> {example.output}
          </li>
        ))}
      </ul>

      <div
        className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/60 bg-background/40 p-4 text-center text-sm text-muted-foreground"
        role="status"
      >
        Think through your solution out loud — speak it to the panel instead of typing it.
      </div>
    </div>
  );
}
