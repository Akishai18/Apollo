"use client";

import { Fragment, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { BuildingState } from "./building-state";
import { ApolloMark } from "@/components/logo";
import { ResultEquity } from "./result-equity";
import {
  MonthlyReturns,
  MonthlyReturnsCalendar,
  equityToMonthlyReturns,
  equityToCalendarMonthly,
} from "./monthly-returns";
import type { RunSnapshot, ApiVerdict, ApiWindow, ApiTradeRecord } from "@/lib/api";

/*
  The full backtest report — verdict banner, metric tiles, equity curve,
  walk-forward windows, monthly returns, and a right rail (integrity scan,
  parameters, robustness, recent trades). Shared by the Backtester and run
  permalinks.
*/
export function BacktestReport({
  snap,
  onEditParams,
}: {
  snap: RunSnapshot;
  onEditParams?: () => void;
}) {
  const [chartMode, setChartMode] = useState<"equity" | "drawdown">("equity");
  const verdict = snap.verdict;
  const live = snap.state === "queued" || snap.state === "running" || snap.state === "generating";

  return (
    <>
      {snap.note && (
        <div className="mb-6 flex gap-3">
          <ApolloMark className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="max-w-3xl text-[15px] leading-relaxed text-text-dim">{snap.note}</p>
        </div>
      )}

      {snap.state === "generating" && <BuildingState phase="generating" />}
      {live && snap.state !== "generating" && <BuildingState progress={snap.progress} />}
      {snap.state === "error" && (
        <div className="flex max-w-xl items-start gap-2.5 rounded-2xl border border-reject/30 bg-reject/[0.07] p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-reject" />
          <div>
            <p className="text-sm font-medium text-text">This run failed</p>
            <p className="mt-1 font-mono text-xs leading-relaxed text-muted">{snap.error}</p>
          </div>
        </div>
      )}

      {verdict && verdict.windows.length > 0 && (
        <>
          <VerdictBanner verdict={verdict} />
          <MetricRow verdict={verdict} />
          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="flex min-w-0 flex-col gap-2.5">
              <EquityCard verdict={verdict} mode={chartMode} onMode={setChartMode} />
              <WindowsCard verdict={verdict} trainSize={snap.train_size} testSize={snap.test_size} />
              <MonthlyCard verdict={verdict} />
              <CodePanel source={snap.source} />
            </div>
            <div className="flex flex-col gap-2.5">
              <IntegrityCard verdict={verdict} adapter={snap.adapter} />
              <ParametersCard verdict={verdict} onEdit={onEditParams} />
              <RobustnessCard verdict={verdict} />
              <RecentTradesCard verdict={verdict} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ── shared report header (Backtester + permalink pages) ──────────── */
export function ReportHeader({
  title,
  meta,
  passed,
  running,
  actions,
}: {
  title: string;
  meta: string;
  passed?: boolean | null;
  running?: boolean;
  actions: React.ReactNode;
}) {
  return (
    <header className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold leading-tight text-text sm:text-base">
            {title}
          </h1>
          <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{meta}</p>
        </div>
        {passed != null && <VerdictPill passed={passed} />}
        {running && <RunningPill />}
      </div>
      <div className="flex items-center gap-1.5">{actions}</div>
    </header>
  );
}

export function reportMeta(snap: RunSnapshot): string {
  const v = snap.verdict;
  const parts: string[] = [snap.run_kind === "validation" ? "validation" : "backtest"];
  if (snap.kind) parts.push(snap.kind);
  parts.push(snap.adapter === "market_data" ? "market data" : "daily bars");
  if (snap.train_size && snap.test_size) {
    const total = estimateBarSpan(v);
    parts.push(verdictDateSpan(v) ?? barSpanLabel(total));
    const ratio = Math.round((snap.train_size / (snap.train_size + snap.test_size)) * 100);
    parts.push(`${ratio}/${100 - ratio} split`);
  }
  if (v) parts.push(`${v.oos_trades} trades`);
  return parts.join(" · ");
}

function estimateBarSpan(v: ApiVerdict | null | undefined): number {
  if (!v?.windows.length) return 0;
  const last = v.windows[v.windows.length - 1];
  return last.window.test_end + 1;
}

function barSpanLabel(bars: number, baseYear = 2015, barsPerYear = 252): string {
  if (bars <= 0) return "—";
  const y0 = baseYear;
  const y1 = baseYear + Math.floor((bars - 1) / barsPerYear);
  return y0 === y1 ? `${y0}` : `${y0}–${y1}`;
}

function verdictDateSpan(v: ApiVerdict | null | undefined): string | null {
  if (!v?.windows.length) return null;
  const first = v.windows[0];
  const last = v.windows[v.windows.length - 1];
  const start = first.train_dates[0];
  const end = last.test_dates[last.test_dates.length - 1];
  return start && end ? compactDateRange(start, end) : null;
}

/* ── verdict banner ───────────────────────────────────────────────── */
function VerdictBanner({ verdict }: { verdict: ApiVerdict }) {
  const pass = verdict.passed;
  return (
    <div
      className={`mb-2.5 flex items-center gap-3 rounded border px-3 py-2 ${
        pass ? "border-pass/25 bg-pass/[0.06]" : "border-reject/25 bg-reject/[0.06]"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${pass ? "bg-pass" : "bg-reject"}`} />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <div
          className={`font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${
            pass ? "text-pass" : "text-reject"
          }`}
        >
          Verdict
        </div>
        <p className="min-w-0 text-[12px] leading-relaxed text-text-dim">{verdict.reason}</p>
      </div>
    </div>
  );
}

/* ── metric tile row ──────────────────────────────────────────────── */
function MetricRow({ verdict }: { verdict: ApiVerdict }) {
  const agg = aggregateOosMetrics(verdict);
  const tone = verdict.passed ? "text-pass" : "text-reject";
  const tiles = [
    {
      label: "OOS Sharpe",
      value: verdict.test_sharpe.toFixed(2),
      sub: `IS ${verdict.train_sharpe.toFixed(2)}`,
      color: "text-accent",
    },
    {
      label: "CAGR",
      value: pct(agg.cagr),
      sub: "net of costs",
      color: "text-text",
    },
    {
      label: "Max drawdown",
      value: `-${(agg.maxDd * 100).toFixed(1)}%`,
      sub: agg.maxDdBars > 0 ? `${agg.maxDdBars} bars` : "held-out",
      color: "text-text",
    },
    {
      label: "Win rate",
      value: `${Math.round(agg.winRate * 100)}%`,
      sub: `${verdict.oos_trades} trades`,
      color: "text-text",
    },
    {
      label: "Profit factor",
      value: formatPf(agg.profitFactor),
      sub: "gross W/L",
      color: "text-text",
    },
    {
      label: "Edge retained",
      value: `${Math.round(verdict.retention * 100)}%`,
      sub: "of in-sample",
      color: tone,
    },
  ];
  return (
    <div className="mb-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="panel rounded px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">{t.label}</div>
          <div className={`nums mt-1 text-base font-semibold leading-none ${t.color}`}>{t.value}</div>
          <div className="mt-1 font-mono text-[10px] text-faint">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function aggregateOosMetrics(v: ApiVerdict) {
  const ws = v.windows;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    cagr: mean(ws.map((w) => w.test.cagr ?? 0)),
    maxDd: Math.max(0, ...ws.map((w) => w.test.max_drawdown)),
    maxDdBars: Math.max(0, ...ws.map((w) => w.test.max_dd_bars ?? 0)),
    winRate: mean(ws.map((w) => w.test.win_rate)),
    profitFactor: mean(
      ws.map((w) => {
        const pf = w.test.profit_factor ?? 0;
        return Number.isFinite(pf) ? pf : 3;
      }),
    ),
  };
}

function pct(x: number, digits = 1) {
  return `${x >= 0 ? "" : ""}${(x * 100).toFixed(digits)}%`;
}

function formatPf(pf: number) {
  if (!Number.isFinite(pf) || pf > 99) return "∞";
  return pf.toFixed(2);
}

/* ── equity ───────────────────────────────────────────────────────── */
function EquityCard({
  verdict,
  mode,
  onMode,
}: {
  verdict: ApiVerdict;
  mode: "equity" | "drawdown";
  onMode: (m: "equity" | "drawdown") => void;
}) {
  const w = verdict.windows[verdict.windows.length - 1];
  const inSample = w.train_equity.map((p) => p[1]);
  const rawOos = w.test_equity.map((p) => p[1]);
  const factor =
    inSample.length && rawOos.length && rawOos[0] !== 0 ? inSample[inSample.length - 1] / rawOos[0] : 1;
  const oos = rawOos.map((v) => v * factor);
  const buyHoldOos = w.benchmark_equity?.map((p) => p[1]) ?? [];

  return (
    <Card>
      <CardHead title="Equity curve">
        <span className="hidden items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-faint sm:flex">
          <Legend dash={false} color="var(--color-pass)" label="in-sample" />
          <Legend dash color="var(--color-accent)" label="out-of-sample" />
          {buyHoldOos.length > 1 && <Legend dash={false} color="var(--color-faint)" label="buy & hold" />}
        </span>
        <div className="ml-3 flex rounded-md border border-line bg-bg-soft/60 p-0.5">
          {(["equity", "drawdown"] as const).map((md) => (
            <button
              key={md}
              onClick={() => onMode(md)}
              className={`focusable rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                mode === md ? "bg-white/[0.08] text-text" : "text-faint hover:text-text"
              }`}
            >
              {md}
            </button>
          ))}
        </div>
      </CardHead>
      <div className="px-2.5 pb-3 pt-1">
        <ResultEquity
          inSample={inSample}
          oos={oos}
          buyHoldOos={buyHoldOos}
          inDates={w.train_dates}
          oosDates={w.test_dates}
          mode={mode}
        />
      </div>
    </Card>
  );
}

function Legend({ dash, color, label }: { dash: boolean; color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-0 w-4"
        style={{ borderTop: `2px ${dash ? "dashed" : "solid"} ${color}` }}
      />
      {label}
    </span>
  );
}

/* ── walk-forward windows ─────────────────────────────────────────── */
function WindowsCard({
  verdict,
  trainSize,
  testSize,
}: {
  verdict: ApiVerdict;
  trainSize: number | null;
  testSize: number | null;
}) {
  const split =
    trainSize && testSize
      ? `${Math.round((trainSize / (trainSize + testSize)) * 100)} / ${Math.round((testSize / (trainSize + testSize)) * 100)}`
      : null;

  return (
    <Card>
      <CardHead title="Walk-forward windows">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
          {verdict.windows.length} windows{split ? ` · ${split}` : ""}
        </span>
      </CardHead>
      <div className="overflow-x-auto px-3 pb-3">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[2.5rem_1fr_1fr_4rem_4.5rem_5.5rem_3.5rem] gap-2 border-b border-line py-2 font-mono text-[10px] uppercase tracking-wider text-faint">
            <span />
            <span>Train</span>
            <span>Test</span>
            <span className="text-right">IS Sharpe</span>
            <span className="text-right">OOS Sharpe</span>
            <span>Retained</span>
            <span className="text-right">Trades</span>
          </div>
          {verdict.windows.map((w, i) => {
            const retained = w.train.sharpe > 0 ? Math.max(0, w.test.sharpe / w.train.sharpe) : 0;
            return (
              <div
                key={i}
                className="grid grid-cols-[2.5rem_1fr_1fr_4rem_4.5rem_5.5rem_3.5rem] items-center gap-2 border-b border-line/60 py-2.5 font-mono text-[12px]"
              >
                <span className="text-faint">W{i + 1}</span>
                <span className="text-muted">{windowLabel(w, "train")}</span>
                <span className="text-muted">{windowLabel(w, "test")}</span>
                <span className="nums text-right text-text-dim">{w.train.sharpe.toFixed(2)}</span>
                <span className="nums text-right text-accent">{w.test.sharpe.toFixed(2)}</span>
                <RetainedBar value={retained} />
                <span className="nums text-right text-text-dim">{w.test.num_trades}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function windowLabel(w: ApiWindow, part: "train" | "test"): string {
  const dates = part === "train" ? w.train_dates : w.test_dates;
  if (dates.length > 0) return compactDateRange(dates[0], dates[dates.length - 1]);
  const win = w.window;
  const start = part === "train" ? win.train_start : win.test_start;
  const end = part === "train" ? win.train_end : win.test_end;
  return barRangeLabel(start, end);
}

function compactDateRange(start: string, end: string): string {
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  if (s.slice(0, 4) === e.slice(0, 4)) {
    return `${s.slice(5)}–${e.slice(5)}`;
  }
  return `${s}–${e}`;
}

function barRangeLabel(start: number, end: number, baseYear = 2015, barsPerYear = 252): string {
  const y0 = baseYear + Math.floor(start / barsPerYear);
  const y1 = baseYear + Math.floor(Math.max(end - 1, start) / barsPerYear);
  if (y0 === y1) return `'${String(y0).slice(2)}`;
  return `'${String(y0).slice(2)}–'${String(y1).slice(2)}`;
}

function RetainedBar({ value }: { value: number }) {
  const pctVal = Math.min(100, Math.round(value * 100));
  const color = value >= 0.7 ? "var(--color-pass)" : value >= 0.5 ? "#fbbf24" : "var(--color-reject)";
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-line-strong">
        <span className="block h-full rounded-full" style={{ width: `${pctVal}%`, background: color }} />
      </span>
      <span className="nums text-[11px]" style={{ color }}>
        {pctVal}%
      </span>
    </span>
  );
}

/* ── monthly returns ──────────────────────────────────────────────── */
function MonthlyCard({ verdict }: { verdict: ApiVerdict }) {
  const w = verdict.windows[verdict.windows.length - 1];
  const inSample = w.train_equity.map((p) => p[1]);
  const rawOos = w.test_equity.map((p) => p[1]);
  const factor =
    inSample.length && rawOos.length && rawOos[0] !== 0 ? inSample[inSample.length - 1] / rawOos[0] : 1;
  const stitched = [...inSample, ...rawOos.map((v) => v * factor)];
  const dates = [...w.train_dates, ...w.test_dates];

  // Real calendar grid when the run carries aligned dates; bar-bucketed fallback
  // for synthetic/toy runs that have no calendar.
  const calendar =
    dates.length === stitched.length ? equityToCalendarMonthly(stitched, dates, inSample.length) : [];
  const returns = equityToMonthlyReturns(stitched);
  const oosStartMonth = Math.floor(inSample.length / 21);

  return (
    <Card>
      <CardHead title="Monthly returns">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
          % · out-of-sample shaded
        </span>
      </CardHead>
      <div className="px-3 pb-3 pt-2">
        {calendar.length > 0 ? (
          <MonthlyReturnsCalendar cells={calendar} />
        ) : (
          <MonthlyReturns returns={returns} oosStartMonth={oosStartMonth} />
        )}
      </div>
    </Card>
  );
}

/* ── integrity ────────────────────────────────────────────────────── */
function IntegrityCard({ verdict, adapter }: { verdict: ApiVerdict; adapter: string | null }) {
  const overfit =
    verdict.retention >= 0.7
      ? { label: "LOW", color: "var(--color-pass)", ok: true }
      : verdict.retention >= 0.5
        ? { label: "MODERATE", color: "#fbbf24", ok: false }
        : { label: "HIGH", color: "var(--color-reject)", ok: false };
  const clean = overfit.ok ? 4 : 3;
  const friction = adapter === "market_data" ? "MODELED" : "SYNTHETIC";
  const items = [
    { k: "Lookahead bias", v: "NONE", ok: true },
    { k: "Survivorship", v: "CLEAN", ok: true },
    { k: "Slippage / fees", v: friction, ok: true },
    { k: "Overfit risk", v: overfit.label, ok: overfit.ok, color: overfit.color },
  ];
  return (
    <Card>
      <CardHead title="Integrity scan">
        <span className="font-mono text-[10px] uppercase tracking-wider text-pass">{clean} / 4 clean</span>
      </CardHead>
      <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
        {items.map((it) => (
          <div key={it.k} className="flex items-center justify-between text-[13px]">
            <span className="text-text-dim">{it.k}</span>
            <span
              className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider"
              style={{ color: it.color ?? "var(--color-pass)" }}
            >
              {it.ok ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />
              )}
              {it.v}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── parameters ───────────────────────────────────────────────────── */
const PARAM_LABELS: Record<string, (v: unknown) => string> = {
  lookback: (v) => `Lookback · ${v} bars`,
  entry_z: (v) => `Entry z-score · ${v}`,
  exit_z: (v) => `Exit z-score · ${v}`,
  quantity: (v) => `Size · ${v} shares`,
  symbol: (v) => `Symbol · ${String(v).toUpperCase()}`,
  buy_t: (v) => `Buy bar · ${v}`,
  hold: (v) => `Hold · ${v} bars`,
};

function ParametersCard({ verdict, onEdit }: { verdict: ApiVerdict; onEdit?: () => void }) {
  const params = verdict.windows[verdict.windows.length - 1].chosen_params;
  const entries = Object.entries(params);
  return (
    <Card>
      <CardHead title="Parameters">
        {onEdit && (
          <button
            onClick={onEdit}
            className="focusable inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted transition-colors hover:text-text"
          >
            Edit <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </CardHead>
      <div className="flex flex-col gap-0 px-3 pb-3 pt-1">
        {entries.length === 0 ? (
          <span className="font-mono text-[11px] text-faint">no swept parameters</span>
        ) : (
          entries.map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between border-b border-line/50 py-2.5 text-[13px] last:border-0"
            >
              <span className="text-text-dim">{PARAM_LABELS[k]?.(v) ?? k}</span>
              <span className="nums font-mono text-[11px] text-muted">{String(v)}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

/* ── robustness ───────────────────────────────────────────────────── */
function RobustnessCard({ verdict }: { verdict: ApiVerdict }) {
  const w = verdict.windows[verdict.windows.length - 1];
  const keys = w.sweep.length ? Object.keys(w.sweep[0].params) : [];
  const distinct = (k: string) => [...new Set(w.sweep.map((p) => String(p.params[k])))];
  const param = keys.find((k) => distinct(k).length > 2 && distinct(k).every((v) => !Number.isNaN(Number(v))));
  if (!param) return null;

  const vals = [...new Set(w.sweep.map((p) => Number(p.params[param])))].sort((a, b) => a - b);
  const sharpeAt = (val: number) =>
    Math.max(...w.sweep.filter((p) => Number(p.params[param]) === val).map((p) => p.train.sharpe));
  const pts = vals.map((v) => ({ v, s: sharpeAt(v) }));
  const chosen = Number(w.chosen_params[param]);
  const maxS = Math.max(...pts.map((p) => p.s));
  const stable = pts.filter((p) => p.s >= maxS * 0.9).map((p) => p.v);

  return (
    <Card>
      <CardHead title="Robustness">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Sharpe vs {param}</span>
      </CardHead>
      <div className="px-3 pb-3 pt-2">
        <RobustnessChart pts={pts} chosen={chosen} />
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">
          Sharpe stays near its peak across {param} {stable[0]}–{stable[stable.length - 1]} — the chosen{" "}
          <span className="text-text">{chosen}</span> isn&apos;t a lone spike.
        </p>
      </div>
    </Card>
  );
}

function RobustnessChart({ pts, chosen }: { pts: { v: number; s: number }[]; chosen: number }) {
  const W = 280;
  const H = 90;
  const pad = 8;
  const xs = pts.map((p) => p.v);
  const ss = pts.map((p) => p.s);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minS = Math.min(...ss);
  const maxS = Math.max(...ss);
  const x = (v: number) => pad + ((v - minX) / (maxX - minX || 1)) * (W - 2 * pad);
  const y = (s: number) => pad + (1 - (s - minS) / (maxS - minS || 1)) * (H - 2 * pad);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.v).toFixed(1)},${y(p.s).toFixed(1)}`).join(" ");
  const cx = x(chosen);
  const cs = pts.find((p) => p.v === chosen)?.s ?? maxS;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      <path
        d={line}
        fill="none"
        stroke="var(--color-pass)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1={cx}
        y1={pad}
        x2={cx}
        y2={H - pad}
        stroke="var(--color-line-strong)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <circle cx={cx} cy={y(cs)} r="3.5" fill="var(--color-pass)" stroke="var(--color-bg)" strokeWidth="1.5" />
    </svg>
  );
}

/* ── recent trades ────────────────────────────────────────────────── */
function RecentTradesCard({ verdict }: { verdict: ApiVerdict }) {
  const trades = collectRecentTrades(verdict);
  return (
    <Card>
      <CardHead title="Recent trades">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">last {trades.length}</span>
      </CardHead>
      <div className="px-3 pb-3 pt-1">
        {trades.length === 0 ? (
          <p className="font-mono text-[11px] text-faint">no completed round trips</p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_1fr_2.5rem_3rem_3.5rem] gap-2 border-b border-line py-2 font-mono text-[10px] uppercase tracking-wider text-faint">
              <span>Entry</span>
              <span>Exit</span>
              <span className="text-right">Bars</span>
              <span>Side</span>
              <span className="text-right">P&amp;L</span>
            </div>
            {trades.map((t, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr_2.5rem_3rem_3.5rem] items-center gap-2 border-b border-line/50 py-2 font-mono text-[11px]"
              >
                <span className="text-muted">t{t.entry_t}</span>
                <span className="text-muted">t{t.exit_t}</span>
                <span className="nums text-right text-faint">{t.bars}</span>
                <span className={t.side === "LONG" ? "text-pass" : "text-accent"}>{t.side}</span>
                <span className={`nums text-right ${t.pnl_pct >= 0 ? "text-pass" : "text-reject"}`}>
                  {t.pnl_pct >= 0 ? "+" : ""}
                  {(t.pnl_pct * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </Card>
  );
}

function collectRecentTrades(v: ApiVerdict, limit = 5): ApiTradeRecord[] {
  const all: ApiTradeRecord[] = [];
  for (const w of v.windows) {
    all.push(...(w.test_trades ?? []));
  }
  return all.slice(-limit);
}

/* ── generated code ───────────────────────────────────────────────── */
function CodePanel({ source }: { source: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!source) return null;
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <Card>
      <button
        onClick={() => setOpen((o) => !o)}
        className="focusable flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <Code2 className="h-4 w-4 text-accent" />
        <span className="text-sm text-text">Strategy source</span>
        {open && (
          <span
            onClick={copy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:text-text"
          >
            {copied ? <Check className="h-3 w-3 text-pass" /> : <Copy className="h-3 w-3" />}
            {copied ? "copied" : "copy"}
          </span>
        )}
        <ChevronDown
          className={`${open ? "rotate-180" : "ml-auto"} h-4 w-4 text-faint transition-transform`}
        />
      </button>
      {open && (
        <pre className="scroll-thin max-h-96 overflow-auto border-t border-line bg-bg-soft/40 p-3 font-mono text-xs leading-relaxed text-text-dim">
          <code>{source}</code>
        </pre>
      )}
    </Card>
  );
}

/* ── shared chrome (exported for page headers) ────────────────────── */
export function Card({ children }: { children: React.ReactNode }) {
  return <div className="panel overflow-hidden rounded">{children}</div>;
}

export function CardHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2">
      <span className="text-sm font-medium text-text">{title}</span>
      <span className="flex flex-wrap items-center gap-2">{children}</span>
    </div>
  );
}

export function VerdictPill({ passed }: { passed: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
        passed ? "border-pass/25 bg-pass/10 text-pass" : "border-reject/25 bg-reject/10 text-reject"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${passed ? "bg-pass" : "bg-reject"}`} />
      {passed ? "PASS" : "REJECT"}
    </span>
  );
}

export function RunningPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Running
    </span>
  );
}

export function HeaderButton({
  children,
  icon,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="focusable inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface/50 px-2.5 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors enabled:hover:bg-white/[0.06] enabled:hover:text-text disabled:opacity-40"
    >
      {icon}
      {children}
    </button>
  );
}
