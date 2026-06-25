"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, FlaskConical, Sparkles } from "lucide-react";
import { PageFrame, PageHeader, FadeUp } from "@/components/app/page-frame";
import { RunRow } from "@/components/app/run-row";
import { useRuns } from "@/lib/runs-context";

type Filter = "all" | "passed" | "rejected" | "running";
const ACTIVE = ["queued", "generating", "running"];

export default function DashboardPage() {
  const { runs, loading, reachable } = useRuns();
  const [filter, setFilter] = useState<Filter>("all");

  const completed = runs.filter((r) => r.state === "completed");
  const passed = completed.filter((r) => r.passed);
  const rejected = completed.filter((r) => r.passed === false);
  const active = runs.filter((r) => ACTIVE.includes(r.state));
  const passRate = completed.length ? Math.round((passed.length / completed.length) * 100) : null;

  const filtered = runs.filter((r) => {
    if (filter === "passed") return r.state === "completed" && r.passed;
    if (filter === "rejected") return r.state === "completed" && r.passed === false;
    if (filter === "running") return ACTIVE.includes(r.state);
    return true;
  });

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        subtitle="Every strategy you've put through the gate — and how it held up."
        action={
          <Link
            href="/app"
            className="accent-gradient focusable inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-accent-ink shadow-lg shadow-accent/25 transition-[filter] hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> New strategy
          </Link>
        }
      />

      {!reachable && !loading && (
        <FadeUp className="mb-6">
          <p className="rounded-xl border border-reject/30 bg-reject/[0.06] p-4 font-mono text-xs text-muted">
            Can&rsquo;t reach the Apollo API — start it with{" "}
            <span className="text-text-dim">uv run uvicorn green.api:app --port 8000</span>.
          </p>
        </FadeUp>
      )}

      {/* hero band: pass-rate gauge + stats */}
      <FadeUp delay={0.05}>
        <div className="panel grid grid-cols-1 gap-6 rounded-2xl p-6 md:grid-cols-[auto_1fr] md:gap-8">
          <div className="flex items-center gap-5">
            <Gauge value={passRate} />
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
                Pass rate
              </div>
              <div className="mt-1 max-w-[12rem] text-sm leading-relaxed text-muted">
                Strategies that survived out-of-sample, of all validated.
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:border-l md:border-line md:pl-8">
            <Stat label="Validated" value={completed.length} />
            <Stat label="Passed" value={passed.length} tone="pass" />
            <Stat label="Rejected" value={rejected.length} tone="reject" />
            <Stat label="Running" value={active.length} tone="accent" />
          </div>
        </div>
      </FadeUp>

      {/* list */}
      <FadeUp delay={0.1} className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-faint">Strategies</h2>
          <div className="flex gap-1">
            {(["all", "passed", "rejected", "running"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`focusable rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  filter === f ? "bg-white/[0.08] text-text" : "text-muted hover:text-text"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="py-12 text-center font-mono text-xs text-faint">Loading…</p>
        ) : filtered.length === 0 ? (
          runs.length === 0 ? (
            <EmptyState />
          ) : (
            <p className="py-12 text-center font-mono text-xs text-faint">Nothing here.</p>
          )
        ) : (
          <div className="flex flex-col gap-2.5">
            {filtered.map((r, i) => (
              <FadeUp key={r.id} delay={Math.min(0.04 * i, 0.3)}>
                <RunRow run={r} />
              </FadeUp>
            ))}
          </div>
        )}
      </FadeUp>
    </PageFrame>
  );
}

/* Hand-rolled SVG donut — no chart lib, matches the report-viz house style. */
function Gauge({ value }: { value: number | null }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = value ?? 0;
  const dash = (pct / 100) * c;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="url(#gauge-grad)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ transition: "stroke-dasharray 0.9s var(--ease-out-soft)" }}
        />
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="var(--color-accent)" />
            <stop offset="1" stopColor="var(--color-accent-2)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="nums text-xl font-semibold text-text">{value != null ? `${value}` : "—"}</span>
        <span className="font-mono text-[9px] text-faint">{value != null ? "percent" : "no data"}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "text",
}: {
  label: string;
  value: number;
  tone?: "text" | "pass" | "reject" | "accent";
}) {
  const color =
    tone === "pass"
      ? "text-pass"
      : tone === "reject"
        ? "text-reject"
        : tone === "accent"
          ? "text-accent"
          : "text-text";
  return (
    <div className="rounded-xl border border-line bg-bg/40 p-3.5">
      <div className={`nums font-display text-2xl font-semibold ${color}`}>{value}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="panel flex flex-col items-center gap-4 rounded-2xl p-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
        <Sparkles className="h-5 w-5 text-accent" />
      </span>
      <div>
        <p className="text-sm font-medium text-text">No strategies yet</p>
        <p className="mt-1 text-sm text-muted">Describe one in plain English, or build it by hand.</p>
      </div>
      <div className="flex gap-2">
        <Link
          href="/app"
          className="focusable inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-accent-ink transition-colors hover:bg-accent-hi"
        >
          <Plus className="h-3.5 w-3.5" /> Describe a strategy
        </Link>
        <Link
          href="/app/backtest"
          className="focusable inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-1.5 text-xs text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text"
        >
          <FlaskConical className="h-3.5 w-3.5" /> Open the Lab
        </Link>
      </div>
    </div>
  );
}
