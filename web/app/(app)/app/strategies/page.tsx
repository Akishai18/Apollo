"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Search, ChevronRight, ChevronDown, ArrowDownWideNarrow } from "lucide-react";
import { PageFrame, FadeUp } from "@/components/app/page-frame";
import { Sparkline } from "@/components/app/sparkline";
import { relativeTime } from "@/components/app/run-row";
import { useRuns } from "@/lib/runs-context";
import type { RunSummary } from "@/lib/api";

const ACTIVE = ["queued", "generating", "running"];
type Filter = "all" | "passing" | "rejected" | "running";
type Sort = "sharpe" | "recent" | "edge";
const SORTS: { key: Sort; label: string }[] = [
  { key: "sharpe", label: "OOS Sharpe" },
  { key: "recent", label: "Recent" },
  { key: "edge", label: "Edge retained" },
];

function isPassing(r: RunSummary) {
  return r.state === "completed" && r.passed === true;
}
function isRejected(r: RunSummary) {
  return (r.state === "completed" && r.passed === false) || r.state === "error";
}
function isRunning(r: RunSummary) {
  return ACTIVE.includes(r.state);
}

export default function StrategiesPage() {
  const { runs, loading } = useRuns();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("sharpe");
  const [query, setQuery] = useState("");
  const [sortOpen, setSortOpen] = useState(false);

  const passing = runs.filter(isPassing);
  const rejected = runs.filter(isRejected);
  const running = runs.filter(isRunning);
  const completed = runs.filter((r) => r.state === "completed");
  const passRate = completed.length ? Math.round((passing.length / completed.length) * 100) : null;
  const avgSharpe = mean(passing.map((r) => r.oos_sharpe).filter(isNum));
  const avgEdge = mean(passing.map((r) => r.edge_retained).filter(isNum));
  const lastValidated = completed.length
    ? relativeTime(completed.map((r) => r.created_at).sort().at(-1) ?? "")
    : "—";

  const combined = combinedEquity(passing.map((r) => r.spark));
  const combinedReturn = combined.length ? combined[combined.length - 1] / combined[0] - 1 : null;

  const q = query.trim().toLowerCase();
  const sortKey = (r: RunSummary) =>
    sort === "recent" ? r.created_at : sort === "edge" ? (r.edge_retained ?? -1) : (r.oos_sharpe ?? -99);
  const rows = runs
    .filter((r) => {
      const text = `${r.title ?? ""} ${r.symbol ?? ""} ${r.kind ?? ""}`.toLowerCase();
      const byFilter =
        filter === "all"
          ? true
          : filter === "passing"
            ? isPassing(r)
            : filter === "rejected"
              ? isRejected(r)
              : isRunning(r);
      return text.includes(q) && byFilter;
    })
    .sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));

  const TABS: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: runs.length },
    { key: "passing", label: "Passing", count: passing.length },
    { key: "rejected", label: "Rejected", count: rejected.length },
    { key: "running", label: "Running", count: running.length },
  ];

  return (
    <PageFrame max="max-w-6xl">
      {/* header */}
      <FadeUp className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Strategies</h1>
          <p className="mt-1 font-mono text-xs text-faint">
            {runs.length} {runs.length === 1 ? "strategy" : "strategies"} · last validated{" "}
            {lastValidated}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="hidden items-center gap-2 rounded-lg border border-line bg-bg/60 px-3 transition-colors focus-within:border-accent/50 sm:flex">
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search strategies, symbols…"
              className="h-9 w-56 bg-transparent text-sm text-text placeholder:text-faint focus:outline-none"
            />
          </div>
          <Link
            href="/app"
            className="accent-gradient focusable inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-accent-ink shadow-lg shadow-accent/25 transition-[filter] hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> New strategy
          </Link>
        </div>
      </FadeUp>

      {/* stat cards */}
      <FadeUp delay={0.05} className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
        <StatCard label="Strategies">
          <div className="nums font-display text-3xl font-semibold text-text">{runs.length}</div>
          <Sub>
            {running.length} running · {completed.length} validated
          </Sub>
        </StatCard>

        <StatCard label="Pass rate">
          <div className="flex items-center justify-between">
            <div className="nums font-display text-3xl font-semibold text-pass">
              {passRate != null ? `${passRate}%` : "—"}
            </div>
            <Gauge value={passRate} />
          </div>
          <Sub>
            <span className="text-pass">{passing.length} pass</span> ·{" "}
            <span className="text-reject">{rejected.length} reject</span> · {running.length} running
          </Sub>
        </StatCard>

        <StatCard label="Avg OOS Sharpe">
          <div className="nums font-display text-3xl font-semibold text-accent">
            {avgSharpe != null ? avgSharpe.toFixed(2) : "—"}
          </div>
          <Sub>across passing strategies</Sub>
        </StatCard>

        <StatCard label="Avg edge retained">
          <div className="nums font-display text-3xl font-semibold text-text">
            {avgEdge != null ? `${Math.round(avgEdge * 100)}%` : "—"}
          </div>
          <Sub>of in-sample performance</Sub>
        </StatCard>

        <StatCard label="Combined equity · passing" className="col-span-2 lg:col-span-4 xl:col-span-1">
          {combined.length > 1 ? (
            <>
              <div className="flex items-center justify-between">
                <span className="nums text-sm font-semibold text-pass">
                  {combinedReturn != null
                    ? `${combinedReturn >= 0 ? "+" : ""}${(combinedReturn * 100).toFixed(1)}%`
                    : ""}
                </span>
                <span className="font-mono text-[10px] text-faint">OOS</span>
              </div>
              <Sparkline values={combined} tone="pass" area className="mt-2 h-12 w-full" id="combined" />
            </>
          ) : (
            <div className="flex h-full items-center font-mono text-[11px] text-faint">
              no passing strategies yet
            </div>
          )}
        </StatCard>
      </FadeUp>

      {/* controls */}
      <FadeUp delay={0.08} className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-full border border-line bg-bg-soft/50 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`focusable rounded-full px-3 py-1.5 text-xs transition-colors ${
                filter === t.key ? "bg-white/[0.08] text-text" : "text-muted hover:text-text"
              }`}
            >
              {t.label} <span className="ml-0.5 font-mono text-[10px] text-faint">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="relative">
          <button
            onClick={() => setSortOpen((o) => !o)}
            className="focusable inline-flex items-center gap-2 rounded-full border border-line bg-bg-soft/50 px-3 py-1.5 font-mono text-[11px] text-muted transition-colors hover:text-text"
          >
            <ArrowDownWideNarrow className="h-3.5 w-3.5" />
            Sort · {SORTS.find((s) => s.key === sort)?.label}
            <ChevronDown className="h-3 w-3 text-faint" />
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} aria-hidden="true" />
              <div className="panel absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-xl p-1">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => {
                      setSort(s.key);
                      setSortOpen(false);
                    }}
                    className={`focusable block w-full rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.05] ${
                      sort === s.key ? "text-text" : "text-muted"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </FadeUp>

      {/* table */}
      <FadeUp delay={0.1}>
        <div className="scroll-thin overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[minmax(0,2fr)_6rem_5rem_6rem_5rem_minmax(8rem,1.4fr)_1.25rem] gap-4 border-b border-line px-3 pb-2 font-mono text-[10px] uppercase tracking-wider text-faint">
              <span>Strategy</span>
              <span>Verdict</span>
              <span>OOS Sharpe</span>
              <span>Edge retained</span>
              <span>Max DD</span>
              <span>Equity · OOS</span>
              <span />
            </div>

            {loading ? (
              <p className="py-14 text-center font-mono text-xs text-faint">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="py-14 text-center font-mono text-xs text-faint">
                {runs.length === 0 ? "No strategies yet." : "No matches."}
              </p>
            ) : (
              rows.map((r) => <Row key={r.id} run={r} />)
            )}
          </div>
        </div>
      </FadeUp>
    </PageFrame>
  );
}

function Row({ run }: { run: RunSummary }) {
  const running = isRunning(run);
  const tone: "pass" | "reject" | "neutral" = isPassing(run)
    ? "pass"
    : isRejected(run)
      ? "reject"
      : "neutral";
  const numTone = tone === "pass" ? "text-pass" : tone === "reject" ? "text-reject" : "text-faint";

  return (
    <Link
      href={`/app/runs/${run.id}`}
      className="group grid grid-cols-[minmax(0,2fr)_6rem_5rem_6rem_5rem_minmax(8rem,1.4fr)_1.25rem] items-center gap-4 border-b border-line px-3 py-3.5 transition-colors hover:bg-white/[0.025]"
    >
      {/* strategy */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-elevated font-mono text-[10px] text-text-dim">
          {badge(run)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-text">{run.title ?? "Strategy"}</div>
          <div className="truncate font-mono text-[11px] text-faint">
            {[run.kind, relativeTime(run.created_at)].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {/* verdict */}
      <VerdictPill run={run} />

      {/* metrics */}
      <span className={`nums text-sm ${numTone}`}>
        {isNum(run.oos_sharpe) ? run.oos_sharpe.toFixed(2) : "—"}
      </span>
      <span className="nums text-sm text-text-dim">
        {isNum(run.edge_retained) ? `${Math.round(run.edge_retained * 100)}%` : "—"}
      </span>
      <span className="nums text-sm text-text-dim">
        {isNum(run.max_dd) ? `-${(run.max_dd * 100).toFixed(1)}%` : "—"}
      </span>

      {/* equity */}
      <div className="flex h-9 items-center">
        {run.spark.length > 1 ? (
          <Sparkline values={run.spark} tone={tone} className="h-8 w-full" id={`sp-${run.id}`} />
        ) : (
          <span className="font-mono text-[11px] text-faint">{running ? "running…" : "not run"}</span>
        )}
      </div>

      <ChevronRight className="h-4 w-4 text-faint transition-colors group-hover:text-accent" />
    </Link>
  );
}

function VerdictPill({ run }: { run: RunSummary }) {
  const map = isPassing(run)
    ? { label: "PASS", c: "text-pass", b: "border-pass/25 bg-pass/10", d: "bg-pass" }
    : isRejected(run)
      ? { label: run.state === "error" ? "ERROR" : "REJECT", c: "text-reject", b: "border-reject/25 bg-reject/10", d: "bg-reject" }
      : { label: "RUNNING", c: "text-accent", b: "border-accent/25 bg-accent/10", d: "bg-accent animate-pulse" };
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${map.b} ${map.c}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${map.d}`} />
      {map.label}
    </span>
  );
}

function StatCard({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel flex flex-col rounded-2xl p-4 ${className}`}>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="flex flex-1 flex-col justify-center">{children}</div>
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 font-mono text-[11px] text-muted">{children}</div>;
}

function Gauge({ value }: { value: number | null }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const dash = ((value ?? 0) / 100) * c;
  return (
    <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="var(--color-pass)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        style={{ transition: "stroke-dasharray 0.8s var(--ease-out-soft)" }}
      />
    </svg>
  );
}

// --- helpers ---------------------------------------------------------------
function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}
function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function badge(run: RunSummary): string {
  if (run.symbol && run.symbol.toUpperCase() !== "SYN") return run.symbol.slice(0, 4).toUpperCase();
  const t = (run.title ?? "S").replace(/[^a-zA-Z ]/g, "").trim();
  return (t.split(/\s+/).map((w) => w[0]).join("") || "S").slice(0, 3).toUpperCase();
}
// Average several normalized OOS sparks into one combined equity curve.
function combinedEquity(sparks: number[][]): number[] {
  const N = 28;
  const norm = sparks
    .filter((s) => s.length > 1 && s[0] !== 0)
    .map((s) =>
      Array.from({ length: N }, (_, i) => s[Math.round((i * (s.length - 1)) / (N - 1))] / s[0]),
    );
  if (!norm.length) return [];
  return Array.from({ length: N }, (_, i) => norm.reduce((a, s) => a + s[i], 0) / norm.length);
}
