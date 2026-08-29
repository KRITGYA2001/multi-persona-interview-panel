'use client';

import { Check } from 'lucide-react';
import { PERSONA_IDS, getPersonaDefinition, type PersonaId } from '@/lib/personas';

interface PersonaSwitcherProps {
  /** Personas enabled for this session's panel, in canonical order. Falls back to all personas if empty. */
  personas: PersonaId[];
  current: PersonaId;
  /** Seconds left on the current persona's timer, for the live countdown badge. */
  remainingSeconds: number;
  isSwitching: boolean;
  error: string | null;
}

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Read-only panel status display: the recruiter sets each persona's time budget at
// setup, and the panel auto-advances on a timer (see ConversationComponent's
// countdown effect) — the candidate no longer drives switching directly.
export function PersonaSwitcher({
  personas,
  current,
  remainingSeconds,
  isSwitching,
  error,
}: PersonaSwitcherProps) {
  const list = personas.length > 0 ? personas : PERSONA_IDS;
  const currentIndex = list.indexOf(current);

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Interview panel status"
    >
      <span className="text-xs font-medium text-muted-foreground">Panelist:</span>
      {list.map((id, index) => {
        const persona = getPersonaDefinition(id);
        const isActive = id === current;
        const isDone = currentIndex >= 0 && index < currentIndex;

        return (
          <div
            key={id}
            aria-label={
              isActive
                ? `${persona.label} panelist — currently active, ${formatCountdown(remainingSeconds)} remaining`
                : isDone
                  ? `${persona.label} panelist — done`
                  : `${persona.label} panelist — upcoming`
            }
            title={persona.focus}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200 ${
              isActive
                ? 'border-primary bg-gradient-to-r from-primary to-secondary text-primary-foreground shadow-[0_4px_14px_-4px_rgba(226,180,189,0.7)]'
                : isDone
                  ? 'border-border/50 bg-muted/40 text-muted-foreground/70'
                  : 'border-border/60 bg-card/60 text-muted-foreground backdrop-blur-sm'
            }`}
          >
            {isSwitching && isActive && (
              <span
                className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden
              />
            )}
            {isDone && <Check className="h-3 w-3 shrink-0" aria-hidden />}
            {persona.label}
            {isActive && !isSwitching && (
              <span className="font-mono tabular-nums opacity-90">
                {formatCountdown(remainingSeconds)}
              </span>
            )}
          </div>
        );
      })}
      {error && (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
