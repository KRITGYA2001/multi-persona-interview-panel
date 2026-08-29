import { SetupScreen } from '@/components/SetupScreen'

export default function Home() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-8 text-foreground">
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
