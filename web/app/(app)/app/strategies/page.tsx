"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownWideNarrow, ChevronRight, Plus, Search } from "lucide-react";
import { PageFrame, FadeUp } from "@/components/app/page-frame";
import { Sparkline } from "@/components/app/sparkline";
import { relativeTime } from "@/components/app/run-row";
import { listStrategies, type StrategySummary, type RunSummary } from "@/lib/api";

type Filter = "all" | "validated" | "rejected" | "active";
type Sort = "recent" | "validated" | "runs";

function isValidated(s: StrategySummary) {
  return s.latest_validation?.passed === true;
}

function isRejected(s: StrategySummary) {
  return s.latest_validation?.passed === false || s.latest_run?.state === "error";
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<StrategySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listStrategies()
      .then((rows) => {
        if (!cancelled) setStrategies(rows);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load strategies. Check that the API is running.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return strategies
      .filter((s) => {
        const text = `${s.title} ${s.description} ${s.latest_run?.symbol ?? ""} ${s.latest_run?.kind ?? ""}`.toLowerCase();
        const byFilter =
          filter === "all"
            ? true
            : filter === "validated"
              ? isValidated(s)
              : filter === "rejected"
                ? isRejected(s)
                : s.status === "active";
        return byFilter && text.includes(q);
      })
      .sort((a, b) => {
        const av = sortValue(a, sort);
        const bv = sortValue(b, sort);
        return av < bv ? 1 : av > bv ? -1 : 0;
      });
  }, [strategies, query, filter, sort]);

  const validated = strategies.filter(isValidated).length;
  const rejected = strategies.filter(isRejected).length;
  const active = strategies.filter((s) => s.status === "active").length;
  const totalRuns = strategies.reduce((n, s) => n + s.runs_count, 0);

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: strategies.length },
    { key: "validated", label: "Validated", count: validated },
    { key: "rejected", label: "Rejected", count: rejected },
    { key: "active", label: "Active", count: active },
  ];

  return (
    <PageFrame>
      <FadeUp className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded border border-accent/20 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
              Library
            </span>
            <h1 className="text-[15px] font-semibold text-text sm:text-base">Strategies</h1>
          </div>
          <p className="mt-1 font-mono text-xs text-faint">
            {strategies.length} strategies · {totalRuns} runs attached
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="hidden h-8 items-center gap-2 rounded border border-line bg-bg/60 px-2 transition-colors focus-within:border-accent/50 sm:flex">
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search strategies…"
              className="h-full w-56 bg-transparent font-mono text-[11px] text-text placeholder:text-faint focus:outline-none"
            />
          </div>
          <Link
            href="/app"
            className="accent-gradient focusable inline-flex h-8 items-center gap-1.5 rounded px-3 font-mono text-[11px] font-medium uppercase tracking-wider text-accent-ink transition-[filter] hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" /> New strategy
          </Link>
        </div>
      </FadeUp>

      <FadeUp delay={0.04} className="mb-3 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        <Stat label="Strategies" value={strategies.length.toString()} sub={`${active} active`} />
        <Stat label="Validated" value={validated.toString()} sub="survived the gate" tone="pass" />
        <Stat label="Rejected" value={rejected.toString()} sub="latest validation failed" tone="reject" />
        <Stat label="Versions" value={sum(strategies.map((s) => s.versions_count)).toString()} sub="frozen drafts" />
      </FadeUp>

      <FadeUp delay={0.08} className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded border border-line bg-bg-soft/50 p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`focusable rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                filter === tab.key ? "bg-white/[0.08] text-text" : "text-muted hover:text-text"
              }`}
            >
              {tab.label} <span className="ml-0.5 text-faint">{tab.count}</span>
            </button>
          ))}
        </div>
        <label className="focusable inline-flex items-center gap-2 rounded border border-line bg-bg-soft/50 px-2.5 py-1 font-mono text-[11px] text-muted">
          <ArrowDownWideNarrow className="h-3.5 w-3.5" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="bg-transparent text-text-dim focus:outline-none"
          >
            <option value="recent">Recent</option>
            <option value="validated">Validation</option>
            <option value="runs">Run count</option>
          </select>
        </label>
      </FadeUp>

      {error && (
        <FadeUp className="mb-3 rounded border border-reject/25 bg-reject/[0.06] px-3 py-2 font-mono text-xs text-reject">
          {error}
        </FadeUp>
      )}

      <FadeUp delay={0.1}>
        <div className="scroll-thin overflow-x-auto">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[minmax(0,2fr)_7rem_7rem_6rem_minmax(8rem,1.2fr)_1.25rem] gap-4 border-b border-line px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
              <span>Strategy</span>
              <span>Status</span>
              <span>Versions</span>
              <span>Runs</span>
              <span>Latest equity</span>
              <span />
            </div>
            {loading ? (
              <p className="py-14 text-center font-mono text-xs text-faint">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="py-14 text-center font-mono text-xs text-faint">
                {strategies.length === 0
                  ? "No strategy records yet. Generate from Builder to create one."
                  : "No matches."}
              </p>
            ) : (
              rows.map((strategy) => <StrategyRow key={strategy.id} strategy={strategy} />)
            )}
          </div>
        </div>
      </FadeUp>
    </PageFrame>
  );
}

function StrategyRow({ strategy }: { strategy: StrategySummary }) {
  const run = strategy.latest_validation ?? strategy.latest_run;
  const tone = run?.passed === true ? "pass" : run?.passed === false ? "reject" : "neutral";
  return (
    <Link
      href={`/app/strategies/${strategy.id}`}
      className="group grid grid-cols-[minmax(0,2fr)_7rem_7rem_6rem_minmax(8rem,1.2fr)_1.25rem] items-center gap-4 border-b border-line px-3 py-2.5 transition-colors hover:bg-white/[0.025]"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-text">{strategy.title}</div>
        <div className="truncate font-mono text-[11px] text-faint">
          {[strategy.description || null, relativeTime(strategy.updated_at)].filter(Boolean).join(" · ")}
        </div>
      </div>
      <Status run={run} />
      <span className="nums text-sm text-text-dim">v{strategy.versions_count}</span>
      <span className="nums text-sm text-text-dim">{strategy.runs_count}</span>
      <div className="h-9">
        {run?.spark && run.spark.length > 1 ? (
          <Sparkline values={run.spark} tone={tone} className="h-8 w-full" id={`strategy-${strategy.id}`} />
        ) : (
          <span className="font-mono text-[11px] text-faint">no completed run</span>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-faint transition-colors group-hover:text-accent" />
    </Link>
  );
}

function Status({ run }: { run?: RunSummary | null }) {
  if (!run) {
    return <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Draft</span>;
  }
  if (run.state === "queued" || run.state === "generating" || run.state === "running") {
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
      <span className={`h-1.5 w-1.5 rounded-full ${pass ? "bg-pass" : "bg-reject"}`} />
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

function sortValue(strategy: StrategySummary, sort: Sort): number | string {
  if (sort === "runs") return strategy.runs_count;
  if (sort === "validated") return strategy.latest_validation?.updated_at ?? "";
  return strategy.updated_at;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
