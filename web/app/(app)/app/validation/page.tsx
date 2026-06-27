"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CheckCircle2, Loader2, Play, ShieldCheck } from "lucide-react";
import { PageFrame, PageHeader, FadeUp } from "@/components/app/page-frame";
import { Sparkline } from "@/components/app/sparkline";
import { relativeTime } from "@/components/app/run-row";
import { useRuns } from "@/lib/runs-context";
import { validateRun, type RunSummary } from "@/lib/api";

const ACTIVE = ["queued", "generating", "running"];

function isActive(run: RunSummary) {
  return ACTIVE.includes(run.state);
}

function isValidation(run: RunSummary) {
  return run.run_kind === "validation";
}

function canPromote(run: RunSummary) {
  return run.run_kind === "backtest" && run.state === "completed";
}

export default function ValidationPage() {
  const router = useRouter();
  const { runs, loading, refresh } = useRuns();
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validations = runs.filter(isValidation);
  const candidates = runs.filter(canPromote);
  const active = validations.filter(isActive);
  const completed = validations.filter((r) => r.state === "completed");
  const passed = completed.filter((r) => r.passed === true);
  const rejected = completed.filter((r) => r.passed === false || r.state === "error");

  async function startValidation(run: RunSummary) {
    setError(null);
    setStartingId(run.id);
    try {
      const { id } = await validateRun(run.id);
      await refresh();
      router.push(`/app/runs/${id}`);
    } catch {
      setError("Could not start validation from that run.");
    } finally {
      setStartingId(null);
    }
  }

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Gate"
        title="Validation"
        subtitle="Formal walk-forward evidence for strategies promoted from the lab."
        icon={<ShieldCheck className="h-4 w-4 text-accent" />}
        action={
          <Link
            href="/app"
            className="accent-gradient focusable inline-flex h-8 items-center gap-1.5 rounded px-3 font-mono text-[11px] font-medium uppercase tracking-wider text-accent-ink transition-[filter] hover:brightness-110"
          >
            New strategy <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <FadeUp className="mb-3 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        <Stat label="Validation runs" value={validations.length.toString()} sub={`${active.length} active`} />
        <Stat label="Validated" value={passed.length.toString()} sub="survived the gate" tone="pass" />
        <Stat label="Rejected" value={rejected.length.toString()} sub="failed or errored" tone="reject" />
        <Stat label="Candidates" value={candidates.length.toString()} sub="completed backtests" />
      </FadeUp>

      {error && (
        <FadeUp className="mb-3 rounded border border-reject/25 bg-reject/[0.06] px-3 py-2 font-mono text-xs text-reject">
          {error}
        </FadeUp>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <FadeUp delay={0.05} className="panel overflow-hidden rounded">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Validation reports</h2>
            <span className="font-mono text-[10px] text-muted">{validations.length} total</span>
          </div>
          {loading ? (
            <Empty>Loading…</Empty>
          ) : validations.length === 0 ? (
            <Empty>No validation runs yet. Promote a completed backtest from the right rail.</Empty>
          ) : (
            <div className="divide-y divide-line">
              {validations.map((run) => (
                <ReportRow key={run.id} run={run} />
              ))}
            </div>
          )}
        </FadeUp>

        <FadeUp delay={0.08} className="panel rounded p-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Promote from backtest</h2>
            <span className="font-mono text-[10px] text-muted">{candidates.length}</span>
          </div>
          {loading ? (
            <Empty compact>Loading…</Empty>
          ) : candidates.length === 0 ? (
            <Empty compact>Run a backtest first, then validate the frozen configuration here.</Empty>
          ) : (
            <div className="flex flex-col gap-1.5">
              {candidates.slice(0, 8).map((run) => (
                <button
                  key={run.id}
                  onClick={() => void startValidation(run)}
                  disabled={startingId === run.id}
                  className="focusable group flex items-center gap-2 rounded border border-line bg-bg-soft/35 px-2.5 py-2 text-left transition-colors hover:border-line-strong hover:bg-white/[0.035] disabled:opacity-50"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line bg-elevated text-accent">
                    {startingId === run.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text">{run.title ?? "Strategy"}</span>
                    <span className="block truncate font-mono text-[10px] text-faint">
                      {[run.kind, relativeTime(run.created_at)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </FadeUp>
      </div>
    </PageFrame>
  );
}

function ReportRow({ run }: { run: RunSummary }) {
  const tone = run.passed === true ? "pass" : run.passed === false || run.state === "error" ? "reject" : "neutral";
  return (
    <Link
      href={`/app/runs/${run.id}`}
      className="grid grid-cols-[minmax(0,1fr)_7rem_6rem_8rem] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.025]"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-text">{run.title ?? "Strategy"}</div>
        <div className="truncate font-mono text-[11px] text-faint">
          {[run.kind, relativeTime(run.created_at)].filter(Boolean).join(" · ")}
        </div>
      </div>
      <Status run={run} />
      <span className="nums text-sm text-text-dim">
        {typeof run.oos_sharpe === "number" ? run.oos_sharpe.toFixed(2) : "—"}
      </span>
      <div className="h-8">
        {run.spark.length > 1 ? (
          <Sparkline values={run.spark} tone={tone} id={`val-${run.id}`} className="h-8 w-full" />
        ) : (
          <span className="font-mono text-[11px] text-faint">pending</span>
        )}
      </div>
    </Link>
  );
}

function Status({ run }: { run: RunSummary }) {
  if (isActive(run)) {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded border border-accent/25 bg-accent/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
        Running
      </span>
    );
  }
  const pass = run.passed === true;
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
        pass ? "border-pass/25 bg-pass/10 text-pass" : "border-reject/25 bg-reject/10 text-reject"
      }`}
    >
      <CheckCircle2 className="h-3 w-3" />
      {pass ? "Validated" : run.state === "error" ? "Error" : "Rejected"}
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "pass" | "reject";
}) {
  const color = tone === "pass" ? "text-pass" : tone === "reject" ? "text-reject" : "text-text";
  return (
    <div className="panel rounded p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">{label}</div>
      <div className={`nums mt-2 text-xl font-semibold ${color}`}>{value}</div>
      <div className="mt-1 font-mono text-[11px] text-muted">{sub}</div>
    </div>
  );
}

function Empty({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <p className={`${compact ? "py-8" : "py-14"} px-3 text-center font-mono text-xs leading-relaxed text-faint`}>
      {children}
    </p>
  );
}
