import { sparkPath } from "@/lib/mock";

/*
  Equity sparkline. Two-series overlay tells the overfit story at a glance: the
  in-sample line (dashed) and the held-out line (solid).
*/
export function EquitySpark({
  values,
  compare,
  color = "var(--color-accent)",
  compareColor = "var(--color-faint)",
  width = 220,
  height = 64,
  className = "",
  label,
}: {
  values: number[];
  compare?: number[];
  color?: string;
  compareColor?: string;
  width?: number;
  height?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={label ?? "equity curve"}
      preserveAspectRatio="none"
    >
      {compare && (
        <path
          d={sparkPath(compare, width, height)}
          fill="none"
          stroke={compareColor}
          strokeWidth="1.25"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d={sparkPath(values, width, height)}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/*
  Filled equity area chart for the product preview — line + soft gradient fill.
*/
export function EquityArea({
  values,
  color = "var(--color-accent)",
  width = 480,
  height = 160,
  className = "",
  id = "eq",
  label = "equity curve",
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
  id?: string;
  label?: string;
}) {
  const line = sparkPath(values, width, height);
  const area = `${line} L${width - 2},${height} L2,${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id}-fill)`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
