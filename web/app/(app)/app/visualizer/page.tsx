"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ScanLine } from "lucide-react";
import { BacktestReport, ReportHeader, reportMeta } from "@/components/app/backtest-report";
import { PageFrame, PageHeader, FadeUp } from "@/components/app/page-frame";
import { Sparkline } from "@/components/app/sparkline";
import { relativeTime } from "@/components/app/run-row";
import { getRun, type ApiWindow, type RunSnapshot, type RunSummary } from "@/lib/api";
import { useRuns } from "@/lib/runs-context";

export default function VisualizerPage() {
  const { runs, loading } = useRuns();
  const completed = useMemo(
    () => runs.filter((r) => r.state === "completed" && r.passed != null),
    [runs],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string>("");
  const [windowIndex, setWindowIndex] = useState(0);
  const [snap, setSnap] = useState<RunSnapshot | null>(null);
  const [compareSnap, setCompareSnap] = useState<RunSnapshot | null>(null);
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);
  const activeId =
    selectedId && completed.some((run) => run.id === selectedId)
      ? selectedId
      : (completed[0]?.id ?? null);
  const showingSelected = !!activeId && snap?.id === activeId;
  const compareTarget = compareId && compareId !== activeId ? compareId : null;
  const displayedCompare =
    compareTarget && compareSnap?.id === compareTarget ? compareSnap : null;
  const selectedWindow = snap?.verdict?.windows[Math.min(windowIndex, snap.verdict.windows.length - 1)];
  const activeLoadError = activeId && loadError?.id === activeId ? loadError.message : null;

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    getRun(activeId)
      .then((run) => {
        if (!cancelled) setSnap(run);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError({ id: activeId, message: "Could not load that evidence bundle." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    if (!compareTarget) return;
    let cancelled = false;
    getRun(compareTarget)
      .then((run) => {
        if (!cancelled) setCompareSnap(run);
      })
      .catch(() => {
        if (!cancelled) setCompareSnap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [compareTarget]);

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Evidence"
        title="Visualizer"
        subtitle="Inspect the evidence bundle behind completed backtests and validation reports."
        icon={<ScanLine className="h-4 w-4 text-accent" />}
        action={
          <Link
            href="/app/backtest"
            className="accent-gradient focusable inline-flex h-8 items-center gap-1.5 rounded px-3 font-mono text-[11px] font-medium uppercase tracking-wider text-accent-ink transition-[filter] hover:brightness-110"
          >
            Run backtest <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <FadeUp className="panel rounded p-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Evidence bundles</h2>
            <span className="font-mono text-[10px] text-muted">{completed.length}</span>
          </div>
          {loading ? (
            <Empty>Loading…</Empty>
          ) : completed.length === 0 ? (
            <Empty>No completed evidence yet. Run a backtest or validation first.</Empty>
          ) : (
            <div className="flex flex-col gap-1.5">
              {completed.map((run) => (
                <RunPick
                  key={run.id}
                  run={run}
                  active={run.id === activeId}
                  onClick={() => setSelectedId(run.id)}
                />
              ))}
            </div>
          )}
          {completed.length > 1 && (
            <div className="mt-4 border-t border-line pt-3">
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                  Compare against
                </span>
                <select
                  value={compareId}
                  onChange={(e) => setCompareId(e.target.value)}
                  className="lab-input font-mono"
                >
                  <option value="">none</option>
                  {completed
                    .filter((run) => run.id !== activeId)
                    .map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.title ?? run.kind ?? run.id}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
        </FadeUp>

        <FadeUp delay={0.05}>
          {activeId && !showingSelected && (
            <div className="panel rounded p-10 text-center font-mono text-xs text-faint">
              {activeLoadError ?? "Loading evidence…"}
            </div>
          )}
          {!activeId && (
            <div className="panel rounded p-10 text-center font-mono text-xs text-faint">
              Select a completed run to inspect.
            </div>
          )}
          {showingSelected && snap && (
            <>
              <ReportHeader
                title={snap.prompt ?? snap.kind ?? "Strategy evidence"}
                meta={reportMeta(snap)}
                passed={snap.verdict?.passed}
                actions={
                  <Link
                    href={`/app/runs/${snap.id}`}
                    className="focusable inline-flex h-8 items-center gap-1.5 rounded border border-line-strong px-2.5 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text"
                  >
                    Full report <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                }
              />
              {snap.verdict && (
                <div className="mb-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_18rem]">
                  <WindowDrilldown
                    windows={snap.verdict.windows}
                    selected={Math.min(windowIndex, snap.verdict.windows.length - 1)}
                    onSelect={setWindowIndex}
                  />
                  <CompareCard primary={snap} compare={displayedCompare} />
                </div>
              )}
              {selectedWindow && <WindowTradeStrip window={selectedWindow} />}
              <BacktestReport snap={snap} />
            </>
          )}
        </FadeUp>
      </div>
    </PageFrame>
  );
}

function WindowDrilldown({
  windows,
  selected,
  onSelect,
}: {
  windows: ApiWindow[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const w = windows[selected];
  if (!w) return null;
  return (
    <div className="panel rounded p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
            Walk-forward window
          </h2>
          <p className="mt-1 font-mono text-[11px] text-muted">
            train {w.window.train_start}–{w.window.train_end} · test {w.window.test_start}–{w.window.test_end}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {windows.map((_, i) => (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className={`focusable rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                i === selected
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line bg-bg-soft/40 text-faint hover:text-text"
              }`}
            >
              W{i + 1}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
        <MiniMetric label="IS Sharpe" value={w.train.sharpe.toFixed(2)} />
        <MiniMetric label="OOS Sharpe" value={w.test.sharpe.toFixed(2)} tone={w.test.sharpe >= 0 ? "pass" : "reject"} />
        <MiniMetric label="Retained" value={`${Math.round((w.test.sharpe / Math.max(w.train.sharpe, 0.001)) * 100)}%`} />
        <MiniMetric label="Trades" value={String(w.test.num_trades)} />
      </div>
    </div>
  );
}

function CompareCard({
  primary,
  compare,
}: {
  primary: RunSnapshot;
  compare: RunSnapshot | null;
}) {
  const p = primary.verdict;
  const c = compare?.verdict;
  return (
    <div className="panel rounded p-3">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Compare</h2>
      {!c || !p ? (
        <p className="mt-8 text-center font-mono text-xs text-faint">Choose another completed run to compare.</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <MiniMetric label="Primary Sharpe" value={p.test_sharpe.toFixed(2)} />
          <MiniMetric label="Compare Sharpe" value={c.test_sharpe.toFixed(2)} />
          <MiniMetric label="Primary retained" value={`${Math.round(p.retention * 100)}%`} />
          <MiniMetric label="Compare retained" value={`${Math.round(c.retention * 100)}%`} />
        </div>
      )}
    </div>
  );
}

function WindowTradeStrip({ window }: { window: ApiWindow }) {
  const trades = window.test_trades.slice(0, 4);
  return (
    <div className="mb-2.5 rounded border border-line bg-bg-soft/35 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Selected trades</span>
        {trades.length === 0 ? (
          <span className="font-mono text-[11px] text-muted">no completed round trips in this window</span>
        ) : (
          trades.map((trade, i) => (
            <span
              key={`${trade.entry_t}-${trade.exit_t}-${i}`}
              className={`rounded border px-2 py-1 font-mono text-[10px] ${
                trade.pnl_pct >= 0
                  ? "border-pass/20 bg-pass/10 text-pass"
                  : "border-reject/20 bg-reject/10 text-reject"
              }`}
            >
              {trade.side} {trade.pnl_pct >= 0 ? "+" : ""}
              {(trade.pnl_pct * 100).toFixed(1)}%
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "pass" | "reject";
}) {
  const color = tone === "pass" ? "text-pass" : tone === "reject" ? "text-reject" : "text-text";
  return (
    <div className="rounded border border-line bg-bg-soft/35 px-2.5 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">{label}</div>
      <div className={`nums mt-1 text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function RunPick({
  run,
  active,
  onClick,
}: {
  run: RunSummary;
  active: boolean;
  onClick: () => void;
}) {
  const tone = run.passed ? "pass" : "reject";
  return (
    <button
      onClick={onClick}
      className={`focusable rounded border px-2.5 py-2 text-left transition-colors ${
        active ? "border-accent/40 bg-accent/10" : "border-line bg-bg-soft/35 hover:border-line-strong"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-text">{run.title ?? "Strategy"}</span>
        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-faint">
          {run.run_kind}
        </span>
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-faint">
        {[run.kind, relativeTime(run.created_at)].filter(Boolean).join(" · ")}
      </div>
      {run.spark.length > 1 && <Sparkline values={run.spark} tone={tone} id={`viz-${run.id}`} className="mt-2 h-8 w-full" />}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center font-mono text-xs leading-relaxed text-faint">{children}</p>;
}
