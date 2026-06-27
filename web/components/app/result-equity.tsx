"use client";

/*
  The hero results chart: in-sample (solid) flows into out-of-sample (dashed,
  accent) across a labeled divider — the overfit story in one line. Optional
  buy-and-hold benchmark (faint grey) rebased on the held-out slice. Toggle to a
  drawdown (underwater) view computed from the same stitched curve.
*/
export function ResultEquity({
  inSample,
  oos,
  buyHoldOos,
  mode,
}: {
  inSample: number[];
  oos: number[];
  buyHoldOos?: number[];
  mode: "equity" | "drawdown";
}) {
  const W = 1000;
  const H = 300;
  const padL = 46;
  const padR = 16;
  const padT = 24;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const combined = [...inSample, ...oos];
  if (combined.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center font-mono text-xs text-faint">
        no equity data
      </div>
    );
  }

  const start = combined[0];
  const series = mode === "drawdown" ? underwater(combined) : combined;
  const min = Math.min(...series, mode === "drawdown" ? 0 : Math.min(...series));
  const max = Math.max(...series, mode === "drawdown" ? 0 : Math.max(...series));
  const span = max - min || 1;
  const x = (i: number) => padL + (i / (combined.length - 1)) * innerW;
  const y = (v: number) => padT + (1 - (v - min) / span) * innerH;

  const splitIdx = inSample.length - 1;
  const splitX = x(splitIdx);

  const pt = (i: number, v: number) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  const path = (vals: number[], offset: number) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${pt(i + offset, v)}`).join(" ");

  const gridVals = [max, min + span / 2, min];

  // Rebase buy-and-hold to continue from in-sample's last equity point.
  let benchmark: number[] | null = null;
  if (buyHoldOos && buyHoldOos.length > 1 && inSample.length > 0) {
    const anchor = inSample[inSample.length - 1];
    const b0 = buyHoldOos[0];
    const factor = b0 !== 0 ? anchor / b0 : 1;
    benchmark = [...inSample.slice(0, -1), ...buyHoldOos.map((v) => v * factor)];
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="equity curve">
      <defs>
        <linearGradient id="re-in" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-pass)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-pass)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="re-dd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-reject)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--color-reject)" stopOpacity="0.25" />
        </linearGradient>
      </defs>

      {gridVals.map((v, i) => {
        const gy = y(v);
        const label =
          mode === "drawdown" ? `${v.toFixed(0)}%` : `${(((v - start) / start) * 100).toFixed(0)}%`;
        return (
          <g key={i}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--color-line)" strokeWidth="1" />
            <text
              x={padL - 8}
              y={gy + 3}
              textAnchor="end"
              className="fill-[var(--color-faint)] font-mono"
              fontSize="10"
            >
              {Number(label.replace("%", "")) > 0 && mode === "equity" ? "+" : ""}
              {label}
            </text>
          </g>
        );
      })}

      {mode === "equity" ? (
        <>
          <rect
            x={splitX}
            y={padT}
            width={W - padR - splitX}
            height={innerH}
            fill="var(--color-accent)"
            opacity="0.05"
          />
          <line
            x1={splitX}
            y1={padT}
            x2={splitX}
            y2={H - padB}
            stroke="var(--color-line-strong)"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
          <text
            x={splitX + 8}
            y={padT + 12}
            className="fill-[var(--color-accent)] font-mono uppercase"
            fontSize="9.5"
            letterSpacing="0.1em"
          >
            out-of-sample →
          </text>

          {benchmark && benchmark.length > 1 && (
            <path
              d={path(benchmark, 0)}
              fill="none"
              stroke="var(--color-faint)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              opacity="0.55"
            />
          )}

          <path
            d={`${path(inSample, 0)} L${splitX.toFixed(1)},${(H - padB).toFixed(1)} L${padL},${(H - padB).toFixed(1)} Z`}
            fill="url(#re-in)"
          />
          <path
            d={path(inSample, 0)}
            fill="none"
            stroke="var(--color-pass)"
            strokeWidth="2"
            strokeLinejoin="round"
          />

          <path
            d={path([inSample[splitIdx], ...oos], splitIdx)}
            pathLength={1}
            className="draw-line"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2.2"
            strokeDasharray="6 5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="var(--color-line-strong)" strokeWidth="1" />
          <path
            d={`${path(series, 0)} L${x(combined.length - 1).toFixed(1)},${y(0).toFixed(1)} L${padL},${y(0).toFixed(1)} Z`}
            fill="url(#re-dd)"
          />
          <path d={path(series, 0)} fill="none" stroke="var(--color-reject)" strokeWidth="2" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

function underwater(equity: number[]): number[] {
  let peak = equity[0];
  return equity.map((v) => {
    peak = Math.max(peak, v);
    return peak > 0 ? -((peak - v) / peak) * 100 : 0;
  });
}
