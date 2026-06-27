"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, FlaskConical, ShieldCheck } from "lucide-react";
import { PageFrame, PageHeader, FadeUp } from "@/components/app/page-frame";
import { Sparkline } from "@/components/app/sparkline";
import { relativeTime } from "@/components/app/run-row";
import {
  getStrategy,
  runVersion,
  type RunSummary,
  type StrategyDetail,
  type StrategyVersion,
} from "@/lib/api";

export default function StrategyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<StrategyDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");
  const [running, setRunning] = useState<"backtest" | "validation" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStrategy(id)
      .then((row) => {
        if (!cancelled) {
          setDetail(row);
          setStatus("ok");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const latestVersion = useMemo(
    () => detail?.versions.toSorted((a, b) => b.version_number - a.version_number)[0] ?? null,
    [detail],
  );
  const latestDraft = detail?.drafts[0] ?? null;
  const latestRun = detail?.runs[0] ?? null;
  const latestValidation = detail?.runs.find((run) => run.run_kind === "validation") ?? null;

  async function launch(version: StrategyVersion, kind: "backtest" | "validation") {
    setRunning(kind);
    setActionError(null);
    try {
      const { id: runId } = await runVersion(version.id, kind);
      router.push(`/app/runs/${runId}`);
    } catch {
      setActionError(`Could not start ${kind}. Check that the API is running.`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <PageFrame>
      {status === "loading" && <p className="font-mono text-sm text-faint">Loading strategy…</p>}
      {status === "missing" && (
        <div className="panel rounded p-10 text-center font-mono text-xs text-faint">Strategy not found.</div>
      )}
      {status === "ok" && detail && (
        <>
          {actionError && (
            <div className="mb-3 rounded border border-reject/25 bg-reject/[0.06] px-3 py-2 font-mono text-xs text-reject">
              {actionError}
            </div>
          )}
          <PageHeader
            eyebrow="Strategy"
            title={detail.strategy.title}
            subtitle={`${detail.versions.length} versions · ${detail.runs.length} runs`}
            action={
              <div className="flex items-center gap-1.5">
                <Link
                  href="/app/strategies"
                  className="focusable inline-flex h-8 items-center gap-1.5 rounded border border-line-strong px-2.5 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Library
                </Link>
                {latestVersion && (
                  <>
                    <button
                      onClick={() => void launch(latestVersion, "backtest")}
                      disabled={running != null}
                      className="focusable inline-flex h-8 items-center gap-1.5 rounded border border-line-strong px-2.5 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text disabled:opacity-40"
                    >
                      <FlaskConical className="h-3.5 w-3.5" /> Backtest
                    </button>
                    <button
                      onClick={() => void launch(latestVersion, "validation")}
                      disabled={running != null}
                      className="accent-gradient focusable inline-flex h-8 items-center gap-1.5 rounded px-3 font-mono text-[11px] font-medium uppercase tracking-wider text-accent-ink transition-[filter] hover:brightness-110 disabled:opacity-40"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Validate
                    </button>
                  </>
                )}
              </div>
            }
          />

          <div className="mb-3 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
            <Stat label="Latest status" value={statusLabel(latestValidation ?? latestRun)} />
            <Stat label="Versions" value={detail.versions.length.toString()} />
            <Stat label="Runs" value={detail.runs.length.toString()} />
            <Stat label="Drafts" value={detail.drafts.length.toString()} />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex flex-col gap-3">
              <FadeUp className="panel overflow-hidden rounded">
                <SectionHeader title="Attached runs" />
                {detail.runs.length === 0 ? (
                  <Empty>No runs attached to this strategy yet.</Empty>
                ) : (
                  <div className="divide-y divide-line">
                    {detail.runs.map((run) => (
                      <RunRow key={run.id} run={run} />
                    ))}
                  </div>
                )}
              </FadeUp>

              <FadeUp delay={0.05} className="panel overflow-hidden rounded">
                <SectionHeader title="Versions" />
                {detail.versions.length === 0 ? (
                  <Empty>No frozen versions yet.</Empty>
                ) : (
                  <div className="divide-y divide-line">
                    {detail.versions.toReversed().map((version) => (
                      <VersionRow key={version.id} version={version} onLaunch={launch} running={running} />
                    ))}
                  </div>
                )}
              </FadeUp>
            </div>

            <FadeUp delay={0.08} className="panel rounded p-3">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Latest draft</h2>
              {latestDraft ? (
                <>
                  <p className="mt-2 text-sm text-text">{latestDraft.prompt ?? detail.strategy.title}</p>
                  <div className="mt-3 rounded border border-line bg-bg-soft/40 p-2">
                    <pre className="scroll-thin max-h-80 overflow-auto font-mono text-[11px] leading-relaxed text-text-dim">
                      <code>{latestDraft.source}</code>
                    </pre>
                  </div>
                </>
              ) : (
                <p className="py-8 text-center font-mono text-xs text-faint">No draft saved yet.</p>
              )}
            </FadeUp>
          </div>
        </>
      )}
    </PageFrame>
  );
}

function RunRow({ run }: { run: RunSummary }) {
  const tone = run.passed === true ? "pass" : run.passed === false ? "reject" : "neutral";
  return (
    <Link
      href={`/app/runs/${run.id}`}
      className="grid grid-cols-[minmax(0,1fr)_6rem_5rem_minmax(8rem,12rem)_1.25rem] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.025]"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-text">{run.title ?? "Run"}</div>
        <div className="truncate font-mono text-[11px] text-faint">
          {[run.run_kind, relativeTime(run.created_at)].join(" · ")}
        </div>
      </div>
      <Status run={run} />
      <span className="nums text-sm text-text-dim">
        {typeof run.oos_sharpe === "number" ? run.oos_sharpe.toFixed(2) : "—"}
      </span>
      <div className="h-8">
        {run.spark.length > 1 ? (
          <Sparkline values={run.spark} tone={tone} id={`run-${run.id}`} className="h-8 w-full" />
        ) : (
          <span className="font-mono text-[11px] text-faint">pending</span>
        )}
      </div>
      <ArrowUpRight className="h-4 w-4 text-faint" />
    </Link>
  );
}

function VersionRow({
  version,
  onLaunch,
  running,
}: {
  version: StrategyVersion;
  onLaunch: (version: StrategyVersion, kind: "backtest" | "validation") => Promise<void>;
  running: "backtest" | "validation" | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div>
        <div className="text-sm font-medium text-text">Version {version.version_number}</div>
        <div className="font-mono text-[11px] text-faint">{relativeTime(version.frozen_at)}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => void onLaunch(version, "backtest")}
          disabled={running != null}
          className="focusable inline-flex h-8 items-center gap-1.5 rounded border border-line-strong px-2.5 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text disabled:opacity-40"
        >
          <FlaskConical className="h-3.5 w-3.5" /> Lab
        </button>
        <button
          onClick={() => void onLaunch(version, "validation")}
          disabled={running != null}
          className="focusable inline-flex h-8 items-center gap-1.5 rounded border border-line-strong px-2.5 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text disabled:opacity-40"
        >
          <ShieldCheck className="h-3.5 w-3.5" /> Gate
        </button>
      </div>
    </div>
  );
}

function Status({ run }: { run: RunSummary }) {
  if (run.state === "queued" || run.state === "generating" || run.state === "running") {
    return <span className="font-mono text-[10px] uppercase tracking-wider text-accent">Running</span>;
  }
  if (run.state === "error") {
    return <span className="font-mono text-[10px] uppercase tracking-wider text-reject">Error</span>;
  }
  return (
    <span className={`font-mono text-[10px] uppercase tracking-wider ${run.passed ? "text-pass" : "text-reject"}`}>
      {run.passed ? "Pass" : "Reject"}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel rounded p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">{label}</div>
      <div className="nums mt-2 text-lg font-semibold text-text">{value}</div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-3 py-2">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">{title}</h2>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-10 text-center font-mono text-xs text-faint">{children}</p>;
}

function statusLabel(run?: RunSummary | null): string {
  if (!run) return "Draft";
  if (run.state === "error") return "Error";
  if (run.state !== "completed") return "Running";
  return run.passed ? "Validated" : "Rejected";
}
