"use client";

import { Loader2 } from "lucide-react";

/*
  Live build/validation progress, driven by the API's WebSocket. `phase` is
  "generating" while Apollo writes the strategy (indeterminate), then "validating"
  for the gate; `progress` is the per-window count once the gate starts reporting.
*/
export function BuildingState({
  progress,
  phase = "validating",
}: {
  progress?: { completed: number; total: number } | null;
  phase?: "generating" | "validating";
}) {
  const generating = phase === "generating";
  const has = !generating && !!progress && progress.total > 0;
  const pct = has ? Math.round((progress!.completed / progress!.total) * 100) : null;

  return (
    <div className="panel w-full max-w-md rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-dim">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          {generating ? "Writing" : "Validating"}
        </span>
        <span className="nums text-[11px] text-faint">{pct != null ? `${pct}%` : "…"}</span>
      </div>

      <div className="relative mb-3 h-1 overflow-hidden rounded-full bg-elevated">
        {pct != null ? (
          <div
            className="accent-gradient h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="bar-indeterminate accent-gradient rounded-full" />
        )}
      </div>

      <p className="font-mono text-xs text-muted">
        {generating
          ? "Writing your strategy from your description…"
          : has
            ? `Walk-forward · window ${progress!.completed} of ${progress!.total}`
            : "Compiling, sandboxing, and backtesting your strategy…"}
      </p>
    </div>
  );
}
