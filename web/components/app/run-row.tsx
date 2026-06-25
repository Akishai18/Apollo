"use client";

import Link from "next/link";
import { ArrowUpRight, CheckCircle2, XCircle, Loader2, CircleDashed } from "lucide-react";
import type { RunSummary } from "@/lib/api";

const ACTIVE = ["queued", "generating", "running"];

export function relativeTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Look = { Icon: typeof CheckCircle2; tone: string; ring: string; label: string };

function look(run: RunSummary): Look {
  if (run.state === "completed")
    return run.passed
      ? { Icon: CheckCircle2, tone: "text-pass", ring: "bg-pass/10", label: "Passed" }
      : { Icon: XCircle, tone: "text-reject", ring: "bg-reject/10", label: "Rejected" };
  if (run.state === "error")
    return { Icon: XCircle, tone: "text-reject/70", ring: "bg-reject/[0.07]", label: "Error" };
  return { Icon: Loader2, tone: "text-accent", ring: "bg-accent/10", label: "Running" };
}

/* A small status pill — PASS / REJECT / RUNNING / ERROR. */
export function StateBadge({ run }: { run: RunSummary }) {
  const { tone, ring, label } = look(run);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${ring} ${tone}`}
    >
      {ACTIVE.includes(run.state) && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {label}
    </span>
  );
}

/* A premium, full-width row linking to a run's permalink. */
export function RunRow({ run }: { run: RunSummary }) {
  const { Icon, tone, ring } = look(run);
  const active = ACTIVE.includes(run.state);
  return (
    <Link
      href={`/app/runs/${run.id}`}
      className="panel panel-hover group flex items-center gap-4 rounded-xl p-4"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ring}`}>
        {active ? (
          <Loader2 className={`h-4 w-4 ${tone} animate-spin`} />
        ) : run.state === "completed" || run.state === "error" ? (
          <Icon className={`h-4 w-4 ${tone}`} />
        ) : (
          <CircleDashed className={`h-4 w-4 ${tone}`} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">{run.title ?? "Strategy"}</div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
          {run.reason ?? (active ? "in progress…" : run.error ?? run.state)}
        </div>
      </div>
      <span className="hidden shrink-0 font-mono text-[10px] text-faint sm:block">
        {relativeTime(run.created_at)}
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-accent" />
    </Link>
  );
}
