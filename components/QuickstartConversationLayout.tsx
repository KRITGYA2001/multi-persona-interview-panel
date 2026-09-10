'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

type QuickstartConversationLayoutProps = {
  statusPanel: ReactNode;
  pipelineMetrics: ReactNode;
  personaPanel?: ReactNode;
  transcriptPanel: ReactNode;
  visualizer: ReactNode;
  controls: ReactNode;
  onEndConversation: () => void;
  /** Label for the header's end button. Defaults to "End Conversation". */
  endLabel?: string;
  /** Live coding question + code box, shown above the visualizer for the technical persona's coding phase. */
  codingPanel?: ReactNode;
};

export function QuickstartConversationLayout({
  statusPanel,
  pipelineMetrics,
  personaPanel,
  transcriptPanel,
  visualizer,
  controls,
  onEndConversation,
  endLabel = 'End Conversation',
  codingPanel,
}: QuickstartConversationLayoutProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col text-left">
      <header className="flex shrink-0 flex-col gap-4 border-b border-border/60 bg-card/30 px-4 py-4 backdrop-blur-md md:h-[76px] md:flex-row md:items-center md:justify-between md:px-6 md:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-sm font-semibold text-primary-foreground shadow-inner">
            MP
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-1">
            <span className="truncate text-lg font-semibold leading-none tracking-[-0.025em] text-foreground">
              Multi Persona
            </span>
            {pipelineMetrics}
          </div>
        </div>

        <div className="flex items-center gap-2 md:pr-1">
          {statusPanel}
          <Button
            variant="destructive"
            size="sm"
            className="h-8 rounded-lg border border-destructive bg-transparent px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            onClick={onEndConversation}
            aria-label={endLabel}
            title={endLabel}
          >
            {endLabel}
          </Button>
        </div>
      </header>

      {personaPanel && (
        <div className="shrink-0 border-b border-border/50 bg-card/20 px-4 py-2 backdrop-blur-md md:px-6">
          {personaPanel}
        </div>
      )}

      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 px-4 pb-4 pt-4 md:px-6 lg:flex-row lg:gap-0">
        <aside className="order-2 h-64 min-h-0 w-full shrink-0 lg:order-1 lg:h-full lg:w-[26rem]">
          {transcriptPanel}
        </aside>

        <main className="order-1 flex min-h-0 flex-1 flex-col lg:order-2 lg:border-l lg:border-border/50 lg:pl-6">
          <div className="flex min-h-0 flex-1 flex-col gap-4 pb-2 pt-3 md:pb-6">
            {codingPanel && <div className="min-h-0 flex-1 overflow-y-auto">{codingPanel}</div>}
            <div className={codingPanel ? 'flex shrink-0 items-center justify-center' : 'flex min-h-0 flex-1 items-center justify-center'}>
              {visualizer}
            </div>
            <div className="shrink-0 pt-4">{controls}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
