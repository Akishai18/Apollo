import type { Sweep } from "@/lib/mock";

/* ----------------------------------------------------------------------------
   Data-viz for the validation report. Hand-rolled SVG/CSS — no chart lib — tuned
   to tell the overfit story: in-sample vs held-out, per-window retention, and the
   parameter-sweep landscape (broad-green = robust, lone-hot-cell = overfit).
---------------------------------------------------------------------------- */

type Tone = "pass" | "reject";
const toneVar = (t: Tone) => (t === "pass" ? "var(--color-pass)" : "var(--color-reject)");

// --- Metric tile (Stripe-style stat) ---------------------------------------
export function MetricTile({
  label,
  value,
  hint,
  tone = "text",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "text" | "pass" | "reject" | "muted";
}) {
  const valueColor = {
    text: "text-text",
    pass: "text-pass",
    reject: "text-reject",
    muted: "text-text-dim",
  }[tone];
  return (
    <div className="rounded-xl border border-line bg-bg-soft/40 px-3.5 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className={`nums mt-1.5 text-xl font-semibold ${valueColor}`}>{value}</div>
      {hint && <div className="mt-0.5 font-mono text-[10px] text-faint">{hint}</div>}
    </div>
  );
}

// --- Equity report (the centerpiece chart) ---------------------------------
export function EquityReport({
  values,
  splitFrac,
  tone,
  id,
}: {
  values: number[];
  splitFrac: number;
  tone: Tone;
  id: string;
}) {
  const W = 600;
  const H = 210;
  const padL = 40;
  const padR = 14;
  const padT = 16;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => padL + (i / (values.length - 1)) * innerW;
  const y = (v: number) => padT + (1 - (v - min) / span) * innerH;

  const splitIdx = Math.floor(values.length * splitFrac);
  const splitX = x(splitIdx);
  const color = toneVar(tone);

  const pt = (i: number, v: number) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  const inPath = values
    .slice(0, splitIdx + 1)
    .map((v, i) => `${i === 0 ? "M" : "L"}${pt(i, v)}`)
    .join(" ");
  const outPath = values
    .slice(splitIdx)
    .map((v, i) => `${i === 0 ? "M" : "L"}${pt(i + splitIdx, v)}`)
    .join(" ");
  const outFill = `${outPath} L${x(values.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L${splitX.toFixed(1)},${(H - padB).toFixed(1)} Z`;

  // gridlines + % return labels relative to the start value
  const start = values[0];
  const lines = [max, min + span / 2, min];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="equity curve">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.26" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* gridlines + y labels */}
      {lines.map((v, i) => {
        const gy = y(v);
        const ret = (((v - start) / start) * 100).toFixed(0);
        return (
          <g key={i}>
            <line
              x1={padL}
              y1={gy}
              x2={W - padR}
              y2={gy}
              stroke="var(--color-line)"
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={gy + 3}
              textAnchor="end"
              className="fill-[var(--color-faint)] font-mono"
              fontSize="9"
            >
              {Number(ret) > 0 ? "+" : ""}
              {ret}%
            </text>
          </g>
        );
      })}

      {/* held-out region shading + divider */}
      <rect
        x={splitX}
        y={padT}
        width={W - padR - splitX}
        height={innerH}
        fill="var(--color-accent)"
        opacity="0.04"
      />
      <line
        x1={splitX}
        y1={padT}
        x2={splitX}
        y2={H - padB}
        stroke="var(--color-line-strong)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text
        x={splitX + 6}
        y={padT + 10}
        className="fill-[var(--color-muted)] font-mono uppercase"
        fontSize="8.5"
        letterSpacing="0.08em"
      >
        held-out →
      </text>

      {/* fill + lines */}
      <path d={outFill} fill={`url(#${id}-fill)`} />
      <path
        d={inPath}
        fill="none"
        stroke="var(--color-muted)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d={outPath}
        pathLength={1}
        className="draw-line"
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// --- Per-window retention bars ---------------------------------------------
export function WindowBars({
  windows,
  tone,
}: {
  windows: { train: number; test: number }[];
  tone: Tone;
}) {
  const maxAbs = 2.6;
  const zone = 64; // px height of the plot zone
  const zero = zone * 0.62; // baseline (more room above for positive)
  const h = (v: number) => (Math.abs(v) / maxAbs) * (v >= 0 ? zero : zone - zero);
  const color = toneVar(tone);

  return (
    <div className="flex items-end justify-between gap-3">
      {windows.map((w, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-2">
          <div className="relative w-full" style={{ height: zone }}>
            {/* zero baseline */}
            <div
              className="absolute inset-x-0 border-t border-dashed border-line-strong"
              style={{ top: zero }}
            />
            <div className="absolute inset-0 flex items-center justify-center gap-2">
              {/* train */}
              <Bar value={w.train} zero={zero} height={h(w.train)} color="var(--color-on-canvas-muted)" />
              {/* test */}
              <Bar value={w.test} zero={zero} height={h(w.test)} color={color} />
            </div>
          </div>
          <span className="font-mono text-[10px] text-faint">W{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

function Bar({
  value,
  zero,
  height,
  color,
}: {
  value: number;
  zero: number;
  height: number;
  color: string;
}) {
  const up = value >= 0;
  return (
    <span
      className="w-3.5 rounded-[2px]"
      style={{
        position: "absolute",
        height: Math.max(2, height),
        background: color,
        top: up ? zero - height : zero,
      }}
    />
  );
}

// --- Parameter-sweep heatmap -----------------------------------------------
export function SweepHeatmap({ sweep }: { sweep: Sweep }) {
  const flat = sweep.values.flat();
  const maxPos = Math.max(0.01, ...flat.filter((v) => v > 0));
  const maxNeg = Math.max(0.01, ...flat.filter((v) => v < 0).map(Math.abs));

  function cellColor(v: number): string {
    if (v >= 0) return `color-mix(in oklab, var(--color-pass) ${Math.round((v / maxPos) * 80)}%, transparent)`;
    return `color-mix(in oklab, var(--color-reject) ${Math.round((Math.abs(v) / maxNeg) * 70)}%, transparent)`;
  }

  return (
    <div>
      <div className="flex gap-2">
        {/* row label (vertical) + row ticks */}
        <div className="flex flex-col justify-between pb-5 pt-0.5 text-right">
          <span className="font-mono text-[9px] uppercase tracking-wider text-faint">
            {sweep.rowLabel}
          </span>
        </div>
        <div className="flex flex-1 flex-col">
          <div className="flex">
            <div className="flex flex-col justify-around pr-2">
              {sweep.rows.map((r) => (
                <span key={r} className="nums text-[10px] leading-none text-faint">
                  {r}
                </span>
              ))}
            </div>
            <div
              className="grid flex-1 gap-1"
              style={{ gridTemplateColumns: `repeat(${sweep.cols.length}, 1fr)` }}
            >
              {sweep.values.map((row, ri) =>
                row.map((v, ci) => {
                  const isBest = sweep.best[0] === ri && sweep.best[1] === ci;
                  return (
                    <div
                      key={`${ri}-${ci}`}
                      title={`${sweep.rowLabel} ${sweep.rows[ri]} · ${sweep.colLabel} ${sweep.cols[ci]} → Sharpe ${v.toFixed(2)}`}
                      className={`flex h-9 items-center justify-center rounded-md font-mono text-[11px] transition-transform hover:scale-[1.06] ${
                        isBest ? "text-text ring-2 ring-accent" : "text-on-canvas-muted"
                      }`}
                      style={{ background: cellColor(v) }}
                    >
                      {v.toFixed(1)}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
          {/* col ticks + label */}
          <div className="mt-1.5 flex" style={{ paddingLeft: "calc(2ch + 0.5rem)" }}>
            <div
              className="grid flex-1 gap-1"
              style={{ gridTemplateColumns: `repeat(${sweep.cols.length}, 1fr)` }}
            >
              {sweep.cols.map((c) => (
                <span key={c} className="nums text-center text-[10px] text-faint">
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-1 text-center font-mono text-[9px] uppercase tracking-wider text-faint">
            {sweep.colLabel}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] ring-2 ring-accent" /> chosen
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-pass/70" /> higher Sharpe
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-reject/60" /> negative
        </span>
      </div>
    </div>
  );
}
