'use client';

import { useEffect, useMemo, useRef } from 'react';
import { getPersonaDefinition } from '@/lib/personas';
import { getPersonaAtTimestamp, type PersonaTimelineEntry } from '@/lib/conversation';

type TranscriptMessage = {
  turn_id?: string | number;
  uid: number;
  text?: string;
  createdAt?: number;
};

type QuickstartTranscriptPanelProps = {
  messageList: TranscriptMessage[];
  currentInProgressMessage: TranscriptMessage | null;
  agentUID: string;
  /** Persona-switch history, used to label each agent turn with the panelist who spoke it and to render switch dividers. */
  personaTimeline?: PersonaTimelineEntry[];
};

type Row =
  | { kind: 'message'; key: string; message: TranscriptMessage }
  | { kind: 'divider'; key: string; label: string };

function formatMessageTime(createdAt?: number) {
  if (!createdAt) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(createdAt));
}

export function QuickstartTranscriptPanel({
  messageList,
  currentInProgressMessage,
  agentUID,
  personaTimeline = [],
}: QuickstartTranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = useMemo(
    () =>
      currentInProgressMessage
        ? [...messageList, currentInProgressMessage]
        : messageList,
    [currentInProgressMessage, messageList],
  );

  // The first timeline entry is the persona active at call start, not a switch —
  // only entries after it produce a "switched to X" divider.
  const rows = useMemo<Row[]>(() => {
    const dividers = personaTimeline
      .slice(1)
      .map((entry) => ({ ts: entry.since, label: getPersonaDefinition(entry.persona).label }));

    const result: Row[] = [];
    let dividerIndex = 0;

    messages.forEach((message, index) => {
      const ts = message.createdAt ?? Infinity;
      while (dividerIndex < dividers.length && dividers[dividerIndex].ts <= ts) {
        result.push({
          kind: 'divider',
          key: `divider-${dividerIndex}`,
          label: dividers[dividerIndex].label,
        });
        dividerIndex += 1;
      }
      result.push({
        kind: 'message',
        key: `${message.turn_id ?? message.uid}-${index}`,
        message,
      });
    });

    while (dividerIndex < dividers.length) {
      result.push({
        kind: 'divider',
        key: `divider-${dividerIndex}`,
        label: dividers[dividerIndex].label,
      });
      dividerIndex += 1;
    }

    return result;
  }, [messages, personaTimeline]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/30 shadow-[0_10px_40px_-20px_rgba(74,74,74,0.3)] backdrop-blur-lg"
      aria-label="Transcription panel"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 px-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Transcript</h2>
          <p className="text-xs text-muted-foreground">Live voice turns</p>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            Start speaking to see the live transcript here.
          </div>
        ) : (
          rows.map((row) => {
            if (row.kind === 'divider') {
              return (
                <div
                  key={row.key}
                  className="flex items-center gap-3 text-xs font-medium text-muted-foreground"
                  role="separator"
                  aria-label={`Switched to ${row.label} panelist`}
                >
                  <span className="h-px flex-1 bg-gradient-to-r from-transparent to-border" />
                  <span>Switched to {row.label}</span>
                  <span className="h-px flex-1 bg-gradient-to-l from-transparent to-border" />
                </div>
              );
            }

            const { message, key } = row;
            const isAgent = String(message.uid) === agentUID;
            const label = isAgent
              ? `${getPersonaDefinition(getPersonaAtTimestamp(personaTimeline, message.createdAt)).label} Panelist`
              : 'You';
            const text = message.text?.trim();
            const time = formatMessageTime(message.createdAt);

            return (
              <article
                key={key}
                className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
              >
                <div className="mb-1 flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
                  <span>{label}</span>
                  {time && <span className="font-normal">{time}</span>}
                </div>
                <div
                  className={`max-w-full whitespace-pre-wrap rounded-xl border px-3 py-2 text-sm leading-6 shadow-sm ${
                    isAgent
                      ? 'border-border/60 bg-card/80 text-foreground backdrop-blur-sm'
                      : 'border-primary/40 bg-gradient-to-br from-primary/15 to-secondary/15 text-foreground'
                  }`}
                >
                  {text || '...'}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
