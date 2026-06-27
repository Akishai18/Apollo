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
