'use client';

import { useState } from 'react';
import { Loader2, X, Check, Copy, Mic, Users, Clock, FileCheck2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ROLE_TEMPLATES } from '@/lib/role-templates';
import { PERSONA_IDS, PERSONA_DEFINITIONS, type PersonaId } from '@/lib/personas';

const cardClass =
  'relative mx-auto w-[min(94vw,62rem)] animate-fade-up overflow-hidden rounded-[28px] border border-border/60 bg-card/80 px-8 py-9 shadow-[0_20px_60px_-15px_rgba(74,74,74,0.28)] backdrop-blur-xl';

const inputClass =
  'mt-2 w-full rounded-xl border border-border/70 bg-muted/50 backdrop-blur-sm transition-shadow focus:shadow-[0_0_0_3px_rgba(226,180,189,0.25)] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_PERSONA_MINUTES = 5;
const MIN_PERSONA_MINUTES = 1;
const MAX_PERSONA_MINUTES = 30;

function defaultPersonaDurations(): Record<PersonaId, number> {
  return PERSONA_IDS.reduce(
    (acc, id) => ({ ...acc, [id]: DEFAULT_PERSONA_MINUTES }),
    {} as Record<PersonaId, number>,
  );
}

function emptyPersonaFocusAreaDrafts(): Record<PersonaId, string> {
  return PERSONA_IDS.reduce((acc, id) => ({ ...acc, [id]: '' }), {} as Record<PersonaId, string>);
}

export function SetupScreen() {
  const [recruiterEmail, setRecruiterEmail] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [templateId, setTemplateId] = useState('software-engineer');
  const [roleTitle, setRoleTitle] = useState(ROLE_TEMPLATES[0].title);
  const [personaFocusAreas, setPersonaFocusAreas] = useState<Record<PersonaId, string[]>>(
    ROLE_TEMPLATES[0].personaFocusAreas,
  );
  const [newFocusAreaDrafts, setNewFocusAreaDrafts] = useState<Record<PersonaId, string>>(
    emptyPersonaFocusAreaDrafts(),
  );
  const [activePersonas, setActivePersonas] = useState<Set<PersonaId>>(
    new Set(PERSONA_IDS),
  );
  const [personaDurations, setPersonaDurations] = useState<Record<PersonaId, number>>(
    defaultPersonaDurations(),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionLink, setSessionLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleTemplateChange(id: string) {
    setTemplateId(id);
    const template = ROLE_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    setRoleTitle(template.title);
    setPersonaFocusAreas(template.personaFocusAreas);
  }

  function addPersonaFocusArea(id: PersonaId) {
    const value = newFocusAreaDrafts[id].trim();
    if (!value || personaFocusAreas[id].includes(value)) {
      setNewFocusAreaDrafts((prev) => ({ ...prev, [id]: '' }));
      return;
    }
    setPersonaFocusAreas((prev) => ({ ...prev, [id]: [...prev[id], value] }));
    setNewFocusAreaDrafts((prev) => ({ ...prev, [id]: '' }));
  }

  function removePersonaFocusArea(id: PersonaId, area: string) {
    setPersonaFocusAreas((prev) => ({ ...prev, [id]: prev[id].filter((a) => a !== area) }));
  }

  function togglePersona(id: PersonaId) {
    setActivePersonas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Keep at least one persona active — an empty panel can't run an interview.
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function setPersonaMinutes(id: PersonaId, minutes: number) {
    const clamped = Math.min(MAX_PERSONA_MINUTES, Math.max(MIN_PERSONA_MINUTES, minutes));
    setPersonaDurations((prev) => ({ ...prev, [id]: clamped }));
  }

  async function handleSubmit() {
    if (!roleTitle.trim()) {
      setError('Role title is required.');
      return;
    }
    if (!EMAIL_PATTERN.test(recruiterEmail.trim())) {
      setError('A valid recruiter email is required.');
      return;
    }
    if (!candidateName.trim()) {
      setError('Candidate name is required.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const activePersonaIds = Array.from(activePersonas);
      const activePersonaFocusAreas = Object.fromEntries(
        activePersonaIds.map((id) => [id, personaFocusAreas[id]]),
      );
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recruiterEmail: recruiterEmail.trim(),
          candidateName: candidateName.trim(),
          roleTitle: roleTitle.trim(),
          focusAreas: Array.from(new Set(activePersonaIds.flatMap((id) => personaFocusAreas[id]))),
          personaFocusAreas: activePersonaFocusAreas,
          activePersonas: activePersonaIds,
          personaDurations: Object.fromEntries(
            activePersonaIds.map((id) => [id, personaDurations[id]]),
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to create session');
      }
      setSessionLink(`${window.location.origin}/interview/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!sessionLink) return;
    await navigator.clipboard.writeText(sessionLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (sessionLink) {
    return (
      <div className={cardClass}>
        <h1 className="text-[26px] font-medium leading-[1.2] text-foreground text-center">
          Interview link ready
        </h1>
        <p className="mt-3 text-sm font-medium leading-6 text-muted-foreground text-center">
          Send this link to your candidate. It opens the mic check and starts the panel.
        </p>
        <div className="mt-8 flex items-center gap-2 rounded-xl border border-border/70 bg-muted/50 backdrop-blur-sm transition-shadow focus:shadow-[0_0_0_3px_rgba(226,180,189,0.25)] px-4 py-3">
          <span className="flex-1 truncate text-sm text-foreground">{sessionLink}</span>
          <button
            onClick={handleCopy}
            aria-label="Copy interview link"
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:text-foreground transition-colors"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground text-center">
          A detailed report will also be emailed to {recruiterEmail} once the interview ends.
        </p>
        <Button
          onClick={() => setSessionLink(null)}
          variant="ghost"
          className="mt-6 w-full text-muted-foreground hover:text-foreground"
        >
          Set up another interview
        </Button>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <h1 className="text-[26px] font-medium leading-[1.2] text-foreground text-center">
        Set up an interview
      </h1>
      <p className="mt-2 text-sm font-medium leading-6 text-muted-foreground text-center">
        Configure the role and the panel, then generate a link for your candidate.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2 md:items-stretch">
        {/* Left column: candidate + role setup, plus a "what to expect" panel to fill the column */}
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold text-foreground">About the role</h2>

          <div className="mt-4">
            <label className={labelClass}>Recruiter email</label>
            <input
              type="email"
              value={recruiterEmail}
              onChange={(e) => setRecruiterEmail(e.target.value)}
              placeholder="you@company.com"
              className={inputClass}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              The detailed report is sent here once the interview ends.
            </p>
          </div>

          <div className="mt-5">
            <label className={labelClass}>Candidate name</label>
            <input
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder="Jane Doe"
              className={inputClass}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              The candidate must enter this same name before the interview starts.
            </p>
          </div>

          <div className="mt-5">
            <label className={labelClass}>Role template</label>
            <select
              value={templateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              className={inputClass}
            >
              {ROLE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id} className="bg-card">
                  {t.id === 'custom' ? 'Custom role' : t.title}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-5">
            <label className={labelClass}>Role title</label>
            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="e.g. Senior Backend Engineer"
              className={inputClass}
            />
          </div>

          {/* Fills the column's remaining height and sets expectations for the recruiter. */}
          <div className="mt-6 flex flex-1 flex-col justify-center gap-4 rounded-xl border border-border/50 bg-muted/20 p-5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              What the candidate walks through
            </span>
            <ul className="flex flex-col gap-3.5 text-sm text-foreground">
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-secondary/25 text-primary">
                  <Mic className="h-3.5 w-3.5" />
                </span>
                <span>
                  <span className="font-medium">Mic check</span>
                  <span className="block text-xs text-muted-foreground">Confirms audio before the panel starts.</span>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-secondary/25 text-primary">
                  <Users className="h-3.5 w-3.5" />
                </span>
                <span>
                  <span className="font-medium">Panel introduction</span>
                  <span className="block text-xs text-muted-foreground">The first panelist opens with an intro, in order.</span>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-secondary/25 text-primary">
                  <Clock className="h-3.5 w-3.5" />
                </span>
                <span>
                  <span className="font-medium">Timed hand-offs</span>
                  <span className="block text-xs text-muted-foreground">Each panelist stays on their focus areas, then hands off automatically.</span>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-secondary/25 text-primary">
                  <FileCheck2 className="h-3.5 w-3.5" />
                </span>
                <span>
                  <span className="font-medium">Feedback report</span>
                  <span className="block text-xs text-muted-foreground">Generated after the call and emailed to you.</span>
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Right column: interview panel */}
        <div>
          <h2 className="text-sm font-semibold text-foreground">Interview panel</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Each panelist auto-hands off to the next when their time runs out, asking only about their own focus areas below.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {PERSONA_IDS.map((id) => {
              const persona = PERSONA_DEFINITIONS[id];
              const active = activePersonas.has(id);
              return (
                <div
                  key={id}
                  className={`rounded-xl border px-4 py-3 transition-all duration-200 ${
                    active
                      ? 'border-primary/70 bg-gradient-to-r from-primary/15 to-secondary/15 shadow-[0_4px_16px_-6px_rgba(226,180,189,0.5)]'
                      : 'border-border/60 bg-muted/30 opacity-60 hover:opacity-80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => togglePersona(id)}
                      aria-pressed={active}
                      className="flex flex-1 items-center justify-between text-left"
                    >
                      <span>
                        <span className="block text-sm font-medium text-foreground">{persona.label}</span>
                        <span className="block text-xs text-muted-foreground">{persona.focus}</span>
                      </span>
                      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                    {active && (
                      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="number"
                          min={MIN_PERSONA_MINUTES}
                          max={MAX_PERSONA_MINUTES}
                          value={personaDurations[id]}
                          onChange={(e) => setPersonaMinutes(id, Number(e.target.value))}
                          aria-label={`${persona.label} panelist time limit in minutes`}
                          className="w-14 rounded-lg border border-border/70 bg-muted/50 px-2 py-1 text-center text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        min
                      </label>
                    )}
                  </div>
                  {active && (
                    <div className="mt-3 border-t border-border/50 pt-3">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Focus areas
                      </span>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {personaFocusAreas[id].map((area) => (
                          <span
                            key={area}
                            className="flex items-center gap-1.5 rounded-full border border-border/70 bg-gradient-to-br from-secondary/60 to-muted/60 px-2.5 py-0.5 text-xs text-foreground shadow-sm"
                          >
                            {area}
                            <button
                              onClick={() => removePersonaFocusArea(id, area)}
                              aria-label={`Remove ${area} from ${persona.label}`}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        {personaFocusAreas[id].length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            No focus areas set — this panelist will stay within their general lane.
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <input
                          value={newFocusAreaDrafts[id]}
                          onChange={(e) =>
                            setNewFocusAreaDrafts((prev) => ({ ...prev, [id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addPersonaFocusArea(id);
                            }
                          }}
                          placeholder={`Add a focus area for ${persona.label}`}
                          className={`flex-1 ${inputClass} mt-0 py-1.5 text-xs`}
                        />
                        <Button
                          onClick={() => addPersonaFocusArea(id)}
                          variant="outline"
                          size="sm"
                          className="shrink-0 border-border bg-transparent text-foreground hover:bg-muted"
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="mt-8 h-11 w-full rounded-xl border border-primary bg-gradient-to-r from-primary to-secondary text-sm font-medium text-primary-foreground shadow-[0_8px_20px_-6px_rgba(226,180,189,0.6)] transition-transform hover:scale-[1.01] hover:from-primary/90 hover:to-secondary/90 disabled:hover:scale-100 disabled:hover:from-primary disabled:hover:to-secondary"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating link...
          </>
        ) : (
          'Generate interview link'
        )}
      </Button>
      {error && <p className="mt-3 text-xs text-destructive text-center">{error}</p>}
    </div>
  );
}
