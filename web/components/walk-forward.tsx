/*
  The lookahead-boundary motif — bars exist up to "now"; the future is literally
  absent (hollow). The core guarantee, drawn.
*/
const PAST = [40, 62, 50, 74, 58, 82, 68, 90];
const FUTURE = [54, 70, 60, 78];

export function LookaheadStrip({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-end gap-[3px] ${className}`} aria-hidden="true">
      {PAST.map((h, i) => (
        <div
          key={`p${i}`}
          className="w-2 rounded-[1px] bg-accent/70"
          style={{ height: `${h}%` }}
        />
      ))}
      <div className="mx-0.5 self-stretch border-l border-dashed border-text/40" />
      {FUTURE.map((h, i) => (
        <div
          key={`f${i}`}
          className="w-2 rounded-[1px] border border-dashed border-line-strong"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

/*
  The walk-forward motif — the product's actual validation method, drawn. Each
  row is a window: a train span, then a held-out test span that slides forward.
*/
export function WalkForward({
  rows = 4,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ marginLeft: `${i * 9}%` }}>
          <div className="flex h-2 items-stretch gap-1">
            <div className="flex-[4] rounded-[2px] bg-white/12" />
            <div className="flex-[2] rounded-[2px] bg-accent" />
          </div>
        </div>
      ))}
      <div className="mt-1 flex gap-4 font-mono text-[10px] uppercase tracking-wider text-faint">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-[2px] bg-white/12" /> train
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-[2px] bg-accent" /> held-out
        </span>
      </div>
    </div>
  );
}
