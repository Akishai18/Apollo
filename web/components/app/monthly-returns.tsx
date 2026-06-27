"use client";

import { Fragment } from "react";

/*
  Monthly returns heatmap — groups bar-level returns into ~21-bar "months" and
  colors cells green/red. Out-of-sample cells get a subtle accent wash.
*/
export function MonthlyReturns({
  returns,
  oosStartMonth,
}: {
  returns: { label: string; value: number }[];
  oosStartMonth: number;
}) {
  if (returns.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center font-mono text-xs text-faint">
        not enough data for monthly returns
      </div>
    );
  }

  const monthsPerRow = 12;
  const rows: { label: string; cells: { label: string; value: number; idx: number }[] }[] = [];
  for (let i = 0; i < returns.length; i += monthsPerRow) {
    const chunk = returns.slice(i, i + monthsPerRow);
    rows.push({
      label: `Y${Math.floor(i / monthsPerRow) + 1}`,
      cells: chunk.map((c, j) => ({ ...c, idx: i + j })),
    });
  }

  const monthLabels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  return (
    <div className="overflow-x-auto">
      <div
        className="inline-grid gap-1 font-mono text-[10px]"
        style={{ gridTemplateColumns: `2.5rem repeat(${monthsPerRow}, minmax(2.25rem, 1fr))` }}
      >
        <span />
        {monthLabels.map((m, i) => (
          <span key={`${m}-${i}`} className="pb-1 text-center uppercase tracking-wider text-faint">
            {m}
          </span>
        ))}

        {rows.map((row) => (
          <Fragment key={row.label}>
            <span className="flex items-center text-faint">{row.label}</span>
            {Array.from({ length: monthsPerRow }, (_, col) => {
              const cell = row.cells[col];
              if (!cell) return <span key={`${row.label}-${col}`} />;
              const pos = cell.value >= 0;
              const oos = cell.idx >= oosStartMonth;
              const intensity = Math.min(Math.abs(cell.value) / 0.04, 1);
              const bg = pos
                ? `color-mix(in oklab, var(--color-pass), transparent ${Math.round((1 - intensity) * 72)}%)`
                : `color-mix(in oklab, var(--color-reject), transparent ${Math.round((1 - intensity) * 72)}%)`;
              return (
                <span
                  key={`${row.label}-${col}`}
                  className={`nums flex h-7 items-center justify-center rounded-md border ${
                    oos ? "border-accent/20" : "border-transparent"
                  }`}
                  style={{ background: bg }}
                  title={`${cell.label}: ${(cell.value * 100).toFixed(1)}%`}
                >
                  {pos ? "+" : ""}
                  {(cell.value * 100).toFixed(1)}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export type MonthCell = { year: number; month: number; value: number; oos: boolean };

/*
  Real calendar monthly returns: a year × 12-month grid. Each cell is the return
  from the prior month-end equity to this month-end. Out-of-sample months are
  shaded. Used when the run carries real dates; toy runs fall back to the
  bar-bucketed grid above.
*/
export function MonthlyReturnsCalendar({ cells }: { cells: MonthCell[] }) {
  if (cells.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center font-mono text-xs text-faint">
        not enough data for monthly returns
      </div>
    );
  }

  const years = [...new Set(cells.map((c) => c.year))].sort((a, b) => a - b);
  const byKey = new Map(cells.map((c) => [`${c.year}-${c.month}`, c]));
  const monthLabels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  return (
    <div className="overflow-x-auto">
      <div
        className="inline-grid gap-1 font-mono text-[10px]"
        style={{ gridTemplateColumns: `3rem repeat(12, minmax(2.25rem, 1fr))` }}
      >
        <span />
        {monthLabels.map((m, i) => (
          <span key={`${m}-${i}`} className="pb-1 text-center uppercase tracking-wider text-faint">
            {m}
          </span>
        ))}

        {years.map((year) => (
          <Fragment key={year}>
            <span className="flex items-center text-faint">{year}</span>
            {Array.from({ length: 12 }, (_, month) => {
              const cell = byKey.get(`${year}-${month}`);
              if (!cell) return <span key={`${year}-${month}`} />;
              return (
                <span
                  key={`${year}-${month}`}
                  className={`nums flex h-7 items-center justify-center rounded-md border ${
                    cell.oos ? "border-accent/20" : "border-transparent"
                  }`}
                  style={{ background: cellColor(cell.value) }}
                  title={`${year}-${String(month + 1).padStart(2, "0")}: ${(cell.value * 100).toFixed(1)}%`}
                >
                  {cell.value >= 0 ? "+" : ""}
                  {(cell.value * 100).toFixed(1)}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function cellColor(value: number): string {
  const intensity = Math.min(Math.abs(value) / 0.04, 1);
  const fade = Math.round((1 - intensity) * 72);
  return value >= 0
    ? `color-mix(in oklab, var(--color-pass), transparent ${fade}%)`
    : `color-mix(in oklab, var(--color-reject), transparent ${fade}%)`;
}

/*
  Turn an equity curve + aligned ISO dates into calendar monthly returns: one
  cell per calendar month, value = month-end / prior-month-end − 1. `oosStartIdx`
  is the first held-out bar index, used to shade OOS months.
*/
export function equityToCalendarMonthly(
  equity: number[],
  dates: string[],
  oosStartIdx: number,
): MonthCell[] {
  if (equity.length < 2 || dates.length !== equity.length) return [];
  const order: string[] = [];
  const lastIdx = new Map<string, number>();
  for (let i = 0; i < dates.length; i++) {
    const ym = dates[i].slice(0, 7);
    if (!lastIdx.has(ym)) order.push(ym);
    lastIdx.set(ym, i);
  }
  const out: MonthCell[] = [];
  let prev = equity[0];
  for (const ym of order) {
    const idx = lastIdx.get(ym)!;
    const cur = equity[idx];
    const value = prev > 0 ? cur / prev - 1 : 0;
    prev = cur;
    const [y, m] = ym.split("-");
    out.push({ year: Number(y), month: Number(m) - 1, value, oos: idx >= oosStartIdx });
  }
  return out;
}

/** Group a bar-level equity curve into ~21-bar monthly returns. */
export function equityToMonthlyReturns(equity: number[], barsPerMonth = 21): { label: string; value: number }[] {
  if (equity.length < 2) return [];
  const out: { label: string; value: number }[] = [];
  for (let i = barsPerMonth; i < equity.length; i += barsPerMonth) {
    const prev = equity[i - barsPerMonth];
    const cur = equity[i];
    if (prev > 0) {
      out.push({ label: `M${out.length + 1}`, value: cur / prev - 1 });
    }
  }
  return out;
}
