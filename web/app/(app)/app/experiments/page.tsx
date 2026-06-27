"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FlaskConical, RefreshCw, RotateCw } from "lucide-react";
import { PageFrame, PageHeader, FadeUp } from "@/components/app/page-frame";
import {
  listDecayAlerts,
  listTrackedRuns,
  revalidatePromoted,
  type DecayAlert,
  type TrackedRun,
} from "@/lib/api";

export default function ExperimentsPage() {
  const [runs, setRuns] = useState<TrackedRun[]>([]);
  const [alerts, setAlerts] = useState<DecayAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [revalidating, setRevalidating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([listTrackedRuns(), listDecayAlerts().catch(() => [])]);
      setRuns(r);
      setAlerts(a);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [r, a] = await Promise.all([listTrackedRuns(), listDecayAlerts().catch(() => [])]);
        if (active) {
          setRuns(r);
          setAlerts(a);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const revalidate = useCallback(async () => {
    setRevalidating(true);
    setNotice(null);
    try {
      const { count } = await revalidatePromoted();
      setNotice(
        count === 0
          ? "No promoted strategies — star a strategy to make it a champion."
          : `Re-validating ${count} promoted strateg${count === 1 ? "y" : "ies"} on current data…`,
      );
    } catch {
      setNotice("Couldn't reach the API.");
    } finally {
      setRevalidating(false);
    }
  }, []);

  return (
    <PageFrame max="max-w-6xl">
      <PageHeader
        eyebrow="MLflow"
        title="Experiments"
        icon={<FlaskConical className="h-6 w-6 text-accent" />}
        subtitle="Every validation logged to MLflow — comparable, reproducible, permanent."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={revalidate}
              disabled={revalidating}
              className="focusable inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface/50 px-3.5 text-xs text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text disabled:opacity-50"
            >
              <RotateCw className={`h-3.5 w-3.5 ${revalidating ? "animate-spin" : ""}`} /> Re-validate
              promoted
            </button>
            <button
              onClick={() => void load()}
              className="focusable inline-flex h-9 w-9 items-center justify-center rounded-full border border-line-strong bg-surface/50 text-muted transition-colors hover:text-text"
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      />

      {notice && (
        <FadeUp className="mb-4">
          <p className="rounded-xl border border-accent/25 bg-accent/[0.06] p-3 font-mono text-xs text-text-dim">
            {notice}
          </p>
        </FadeUp>
      )}

      {alerts.length > 0 && (
        <FadeUp className="mb-4">
          <div className="rounded-xl border border-reject/30 bg-reject/[0.06] p-4">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-reject">
              <AlertTriangle className="h-3.5 w-3.5" /> Decay — {alerts.length} promoted strateg
              {alerts.length === 1 ? "y" : "ies"} no longer holding up
            </div>
            <ul className="flex flex-col gap-1">
              {alerts.map((a) => (
                <li key={a.strategy_id} className="font-mono text-[11px] text-text-dim">
                  • {a.title}
                  {a.symbol ? ` [${a.symbol}]` : ""} — {a.reason}
                </li>
              ))}
            </ul>
          </div>
        </FadeUp>
      )}

      {loading ? (
        <p className="py-12 text-center font-mono text-xs text-faint">Loading…</p>
      ) : runs.length === 0 ? (
        <EmptyState />
      ) : (
        <FadeUp delay={0.05}>
          <div className="scroll-thin overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[minmax(0,2fr)_5rem_6rem_5rem_5rem_5rem_6rem] gap-4 border-b border-line px-3 pb-2 font-mono text-[10px] uppercase tracking-wider text-faint">
                <span>Run</span>
                <span>Symbol</span>
                <span>Verdict</span>
                <span className="text-right">OOS Sharpe</span>
                <span className="text-right">Retained</span>
                <span className="text-right">Trades</span>
                <span className="text-right">When</span>
              </div>
              {runs.map((r) => (
                <Row key={r.run_id} run={r} />
              ))}
            </div>
          </div>
        </FadeUp>
      )}
    </PageFrame>
  );
}

function Row({ run }: { run: TrackedRun }) {
  const tone = run.passed ? "text-pass" : run.passed === false ? "text-reject" : "text-faint";
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_5rem_6rem_5rem_5rem_5rem_6rem] items-center gap-4 border-b border-line/60 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm text-text">{run.name}</div>
        <div className="truncate font-mono text-[11px] text-faint">
          {[run.run_kind, run.adapter].filter(Boolean).join(" · ")}
        </div>
      </div>
      <span className="font-mono text-xs text-text-dim">{run.symbol ?? "—"}</span>
      <span className={`font-mono text-[10px] uppercase tracking-wider ${tone}`}>
        {run.passed === null ? "—" : run.passed ? "PASS" : "REJECT"}
      </span>
      <span className={`nums text-right text-sm ${tone}`}>{fmt(run.oos_sharpe, 2)}</span>
      <span className="nums text-right text-sm text-text-dim">
        {run.retention != null ? `${Math.round(run.retention * 100)}%` : "—"}
      </span>
      <span className="nums text-right text-sm text-text-dim">{fmt(run.oos_trades, 0)}</span>
      <span className="text-right font-mono text-[10px] text-faint">{when(run.created_at)}</span>
    </div>
  );
}

function fmt(v: number | null, digits: number): string {
  return v == null ? "—" : v.toFixed(digits);
}

function when(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function EmptyState() {
  return (
    <div className="panel flex flex-col items-center gap-3 rounded-2xl p-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
        <FlaskConical className="h-5 w-5 text-accent" />
      </span>
      <div>
        <p className="text-sm font-medium text-text">No tracked runs yet</p>
        <p className="mt-1 max-w-md text-sm text-muted">
          Run a backtest and your validations show up here — comparable and reproducible.
        </p>
      </div>
    </div>
  );
}
