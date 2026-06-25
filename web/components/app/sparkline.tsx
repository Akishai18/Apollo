/*
  A tiny hand-rolled equity sparkline — no chart lib. Scales to its box via the
  SVG viewBox; tone colors the line (pass/reject/neutral) and an optional faint
  area fill underneath.
*/
type Tone = "pass" | "reject" | "neutral";

const STROKE: Record<Tone, string> = {
  pass: "var(--color-pass)",
  reject: "var(--color-reject)",
  neutral: "var(--color-muted)",
};

export function Sparkline({
  values,
  tone = "neutral",
  area = false,
  strokeWidth = 1.6,
  className = "h-9 w-32",
  id,
}: {
  values: number[];
  tone?: Tone;
  area?: boolean;
  strokeWidth?: number;
  className?: string;
  id: string;
}) {
  if (!values || values.length < 2) return null;
  const W = 160;
  const H = 44;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad);

  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const fill = `${line} L${W},${H} L0,${H} Z`;
  const color = STROKE[tone];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label="out-of-sample equity"
    >
      {area && (
        <>
          <defs>
            <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fill} fill={`url(#${id}-f)`} />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
