import { SetupScreen } from '@/components/SetupScreen'

export default function Home() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-8 text-foreground">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
        {/* Overhead spotlight, like a panel room key light */}
        <div
          className="absolute left-1/2 top-0 h-[560px] w-[1100px] -translate-x-1/2 -translate-y-1/3 rounded-full opacity-60 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, hsl(var(--primary) / 0.35), transparent 70%)' }}
        />
        {/* Ambient corner glows */}
        <div
          className="absolute -left-40 bottom-[-6rem] h-[420px] w-[420px] rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, hsl(var(--secondary) / 0.55), transparent 70%)' }}
        />
        <div
          className="absolute -right-32 top-1/3 h-[360px] w-[360px] rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, hsl(var(--accent) / 0.4), transparent 70%)' }}
        />
        {/* Faint conference-room blinds texture */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(180deg, hsl(var(--foreground)) 0px, hsl(var(--foreground)) 1px, transparent 1px, transparent 48px)',
          }}
        />
        {/* Table-edge horizon line */}
        <div
          className="absolute inset-x-0 bottom-0 h-px opacity-[0.08]"
          style={{ background: 'linear-gradient(90deg, transparent, hsl(var(--foreground)), transparent)' }}
        />
      </div>
      <div className="flex items-center gap-3 rounded-full border border-border/50 bg-card/60 px-4 py-2 shadow-[0_8px_24px_-8px_rgba(74,74,74,0.18)] backdrop-blur-md animate-fade-up">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-sm font-semibold text-primary-foreground shadow-inner">
          MP
        </div>
        <span className="text-lg font-semibold leading-none tracking-[-0.025em] text-foreground">
          Multi Persona
        </span>
      </div>
      <SetupScreen />
    </div>
  )
}
