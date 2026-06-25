/*
  Map the backend's `Verdict` JSON into the report view-model the UI renders
  (`RunScenario`). All the chart/metric shaping lives here so the components stay
  presentational and the API contract has one translation point.
*/

import type { ApiVerdict, ApiWindow } from "./api";
import type { RunScenario, Sweep } from "./mock";

const pct = (x: number, sign = false) => `${sign && x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function verdictToReport(
  v: ApiVerdict,
  strategyName: string,
  windowIndex?: number,
): RunScenario {
  const windows = v.windows;
  // Which window drives the per-window panels (equity / sweep / chosen params).
  // Defaults to the last window; the visualizer passes an index to scrub.
  const idx =
    windowIndex != null && windowIndex >= 0 && windowIndex < windows.length
      ? windowIndex
      : windows.length - 1;
  const last = windows[idx];

  const params = Object.entries(last?.chosen_params ?? {}).map(([k, val]) => ({
    k,
    v: String(val),
  }));

  const oosReturn = mean(windows.map((w) => w.test.total_return));
  const maxDD = Math.max(0, ...windows.map((w) => w.test.max_drawdown));
  const winRate = mean(windows.map((w) => w.test.win_rate));

  return {
    strategy: strategyName,
    params,
    passed: v.passed,
    reason: v.reason,
    reply: v.passed
      ? "It holds up out of sample — the edge survives data the tuning never saw. Here’s the report."
      : "I’d pass on this — it doesn’t survive out of sample. Here’s exactly why.",
    metrics: {
      sharpeTrain: v.train_sharpe.toFixed(2),
      sharpeTest: v.test_sharpe.toFixed(2),
      retention: `${Math.round(v.retention * 100)}%`,
      oosReturn: pct(oosReturn, true),
      maxDrawdown: `-${(maxDD * 100).toFixed(1)}%`,
      winRate: `${Math.round(winRate * 100)}%`,
      oosTrades: String(v.oos_trades),
      windows: windows.length,
    },
    ...equity(last),
    windowBars: windows.map((w) => ({ train: w.train.sharpe, test: w.test.sharpe })),
    sweep: buildSweep(last),
  };
}

// Continuous equity: in-sample window, then the held-out window rebased to
// continue from where in-sample ended (faithful compounding, one legible line).
function equity(last: ApiWindow | undefined): { equity: number[]; splitFrac: number } {
  if (!last) return { equity: [100, 100], splitFrac: 0.5 };
  const train = last.train_equity.map((p) => p[1]);
  const test = last.test_equity.map((p) => p[1]);
  if (train.length === 0 || test.length === 0) {
    const series = train.length ? train : test;
    return { equity: series, splitFrac: 1 };
  }
  const factor = train[train.length - 1] / test[0];
  const rebased = test.map((x) => x * factor);
  const all = [...train, ...rebased];
  return { equity: all, splitFrac: train.length / all.length };
}

// Build a sweep heatmap from the chosen window's grid: the two parameters that
// actually varied become the axes, cells are train Sharpe, the chosen cell rings.
function buildSweep(last: ApiWindow | undefined): Sweep {
  const empty: Sweep = { rowLabel: "", colLabel: "", rows: [], cols: [], values: [[]], best: [0, 0] };
  if (!last || last.sweep.length === 0) return empty;

  const points = last.sweep;
  const keys = Object.keys(points[0].params);
  const distinct = (k: string) => [...new Set(points.map((p) => String(p.params[k])))];
  const varying = keys.filter((k) => distinct(k).length > 1);

  const sortVals = (vals: string[]) => {
    const allNum = vals.every((v) => v !== "" && !Number.isNaN(Number(v)));
    return [...vals].sort((a, b) => (allNum ? Number(a) - Number(b) : a.localeCompare(b)));
  };
  const sharpeAt = (pred: (p: Record<string, unknown>) => boolean) =>
    points.find((p) => pred(p.params))?.train.sharpe ?? 0;

  // <2 varying params → a single column of whatever varies (or a 1×1 cell)
  if (varying.length < 2) {
    const rowKey = varying[0];
    if (!rowKey) {
      return {
        rowLabel: "params",
        colLabel: "Sharpe",
        rows: ["—"],
        cols: ["Sharpe"],
        values: [[points[0].train.sharpe]],
        best: [0, 0],
      };
    }
    const rows = sortVals(distinct(rowKey));
    return {
      rowLabel: rowKey,
      colLabel: "Sharpe",
      rows,
      cols: ["Sharpe"],
      values: rows.map((rv) => [sharpeAt((p) => String(p[rowKey]) === rv)]),
      best: [rows.indexOf(String(last.chosen_params[rowKey])), 0],
    };
  }

  const [rowKey, colKey] = varying;
  const rows = sortVals(distinct(rowKey));
  const cols = sortVals(distinct(colKey));
  const values = rows.map((rv) =>
    cols.map((cv) => sharpeAt((p) => String(p[rowKey]) === rv && String(p[colKey]) === cv)),
  );
  return {
    rowLabel: rowKey,
    colLabel: colKey,
    rows,
    cols,
    values,
    best: [
      rows.indexOf(String(last.chosen_params[rowKey])),
      cols.indexOf(String(last.chosen_params[colKey])),
    ],
  };
}
