"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { Composer } from "./composer";
import { RunResult } from "./run-result";
import { Launchpad } from "./launchpad";
import { verdictToReport } from "@/lib/report";
import {
  API_BASE,
  getTemplates,
  submitRun,
  submitGeneration,
  streamRun,
  type ApiTemplate,
  type RunSnapshot,
  type TierKey,
} from "@/lib/api";
import type { RunScenario } from "@/lib/mock";

export type Run = {
  id: string;
  prompt: string;
  status: "generating" | "building" | "done" | "error";
  progress?: { completed: number; total: number } | null;
  report?: RunScenario;
  note?: string; // Apollo's rationale (natural-language runs)
  error?: string;
};

/*
  The workspace — wired to the live API. A free-text prompt is sent to POST
  /generate (Apollo writes the strategy, server-side model per tier), then it runs
  through the same gate; a one-click template skips straight to POST /runs. Either
  way we stream real progress + the real verdict over a WebSocket and render inline.
*/
export function Workspace() {
  const reduce = useReducedMotion() ?? false;
  const [runs, setRuns] = useState<Run[]>([]);
  const [templates, setTemplates] = useState<ApiTemplate[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  const patch = useCallback((id: string, fn: (r: Run) => Run) => {
    setRuns((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
  }, []);

  function submit(prompt: string, tier: TierKey, explicit?: ApiTemplate) {
    const id = crypto.randomUUID();
    const title = explicit?.name ?? "Your strategy";
    // Templates run a known-good config immediately; free text is generated first.
    setRuns((prev) => [
      ...prev,
      { id, prompt, status: explicit ? "building" : "generating", progress: null },
    ]);

    const onSnapshot = (snap: RunSnapshot) =>
      patch(id, (r) => ({
        ...r,
        // generating → building once the gate starts (or any note/progress lands)
        status: r.status === "generating" && snap.state !== "generating" ? "building" : r.status,
        progress: snap.progress,
        note: snap.note ?? r.note,
      }));

    const onSettled = (snap: RunSnapshot) => {
      if (snap.state === "completed" && snap.verdict) {
        const report = verdictToReport(snap.verdict, title);
        patch(id, (r) => ({ ...r, status: "done", report, note: snap.note ?? r.note }));
      } else {
        patch(id, (r) => ({ ...r, status: "error", error: snap.error ?? "The run failed." }));
      }
    };

    const onError = () =>
      patch(id, (r) =>
        r.status === "generating" || r.status === "building"
          ? { ...r, status: "error", error: "Lost connection to the API." }
          : r,
      );

    const start = explicit ? submitRun(explicit.request) : submitGeneration(prompt, tier);
    start
      .then(({ id: apiId }) => streamRun(apiId, { onSnapshot, onSettled, onError }))
      .catch(() => {
        patch(id, (r) => ({
          ...r,
          status: "error",
          error: `Can't reach the Apollo API at ${API_BASE}. Start it with: uv run uvicorn green.api:app --port 8000`,
        }));
      });
  }

  const lastStatus = runs[runs.length - 1]?.status;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [runs.length, lastStatus, reduce]);

  const active = runs.length > 0;

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col">
      {/* subtle background */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="dot-grid fade-down absolute inset-0 opacity-50" />
        <div className="app-glow absolute left-1/2 top-0 h-[460px] w-[620px] rounded-full bg-accent/[0.07] blur-[130px]" />
      </div>

      {active ? (
        <>
          <header className="hidden h-16 shrink-0 items-center justify-between border-b border-line px-6 md:flex">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text">Strategy session</span>
              <span className="rounded-full border border-line bg-surface/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                {runs.length} run{runs.length > 1 ? "s" : ""}
              </span>
            </div>
            <button
              onClick={() => setRuns([])}
              className="focusable inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface/50 px-3 py-1.5 text-xs text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text"
            >
              <Plus className="h-3.5 w-3.5" /> New strategy
            </button>
          </header>

          <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-6 py-8">
            <div className="mx-auto flex max-w-3xl flex-col gap-12">
              {runs.map((r) => (
                <RunResult key={r.id} run={r} />
              ))}
            </div>
          </div>

          <div className="shrink-0 border-t border-line bg-bg/60 px-6 py-4 backdrop-blur-sm">
            <div className="mx-auto max-w-3xl">
              <Composer
                onSubmit={(p, tier) => submit(p, tier)}
                placeholder="Describe another strategy, or refine this one…"
              />
            </div>
          </div>
        </>
      ) : (
        <Launchpad templates={templates} onSubmit={(p, tier, t) => submit(p, tier, t)} />
      )}
    </div>
  );
}
