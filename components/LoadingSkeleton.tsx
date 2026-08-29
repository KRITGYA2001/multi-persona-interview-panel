'use client';

const SKELETON_BAR_HEIGHTS = Array.from(
  { length: 40 },
  (_, index) => `${20 + ((index * 17) % 60)}%`,
);

export function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-4 h-full animate-pulse">
      {/* Mirrors the top-right exit control while the browser-only conversation UI loads. */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <div className="h-9 w-32 bg-muted/50 rounded-md" />
      </div>

      {/* Center visualization placeholder so the layout stays stable during lazy load. */}
      <div className="relative h-56 w-full flex items-center justify-center">
        <div className="w-full max-w-2xl px-4">
          <div className="flex items-end justify-center gap-1 h-32">
            {SKELETON_BAR_HEIGHTS.map((height, i) => (
              <div
                key={i}
                className="w-1 bg-gradient-to-t from-primary/30 to-secondary/30 rounded-full"
                style={{ height }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Small status line placeholder beneath the visualizer. */}
      <div className="text-center h-4">
        <div className="h-3 w-24 bg-muted/50 rounded mx-auto" />
      </div>

      {/* Bottom control dock placeholder for mute and device controls. */}
      <div className="fixed bottom-14 md:bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-card/70 border border-border/60 rounded-full px-4 py-2 backdrop-blur-xl shadow-[0_10px_30px_-10px_rgba(74,74,74,0.3)]">
        <div className="w-2 h-2 bg-muted/50 rounded-full" />
        <div className="w-12 h-12 bg-muted/50 rounded-full" />
        <div className="w-10 h-10 bg-muted/50 rounded-full" />
      </div>

      {/* Transcript panel placeholder in the same anchored position as the live chat stream. */}
      <div className="fixed bottom-32 right-4 w-80 bg-card/70 backdrop-blur-xl rounded-2xl border border-border/60 p-4 shadow-[0_10px_30px_-10px_rgba(74,74,74,0.3)]">
        <div className="space-y-3">
          <div className="h-4 w-3/4 bg-muted/50 rounded" />
          <div className="h-4 w-1/2 bg-muted/50 rounded" />
          <div className="h-4 w-5/6 bg-muted/50 rounded" />
        </div>
      </div>
    </div>
  );
}
