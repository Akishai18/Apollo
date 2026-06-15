"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { ApolloMark } from "@/components/logo";
import { Composer } from "./composer";
import { RunResult } from "./run-result";
import { RUN_SCENARIOS, type RunScenario } from "@/lib/mock";

type Run = { id: string; prompt: string; scn: RunScenario };

export function Workspace() {
  const reduce = useReducedMotion() ?? false;
  const [runs, setRuns] = useState<Run[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  function submit(prompt: string) {
    setRuns((prev) => [
      ...prev,
      { id: crypto.randomUUID(), prompt, scn: RUN_SCENARIOS[prev.length % RUN_SCENARIOS.length] },
    ]);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [runs.length, reduce]);

  const active = runs.length > 0;

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col">
      {/* subtle background: faint dot-grid + one slow drifting glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="dot-grid fade-down absolute inset-0 opacity-50" />
        <div className="app-glow absolute left-1/2 top-0 h-[460px] w-[620px] rounded-full bg-accent/[0.07] blur-[130px]" />
      </div>

      {/* top bar (desktop; on mobile the AppShell bar carries the chrome) */}
      <header className="hidden h-16 shrink-0 items-center justify-between border-b border-line px-6 md:flex">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text">
            {active ? "Strategy session" : "New strategy"}
          </span>
          <span className="rounded-full border border-line bg-surface/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">
            {active ? `${runs.length} run${runs.length > 1 ? "s" : ""}` : "draft"}
          </span>
        </div>
        {active && (
          <button
            onClick={() => setRuns([])}
            className="focusable inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface/50 px-3 py-1.5 text-xs text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text"
          >
            <Plus className="h-3.5 w-3.5" /> New strategy
          </button>
        )}
      </header>

      {active ? (
        <>
          <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-6 py-8">
            <div className="mx-auto flex max-w-3xl flex-col gap-12">
              {runs.map((r) => (
                <RunResult key={r.id} prompt={r.prompt} scn={r.scn} />
              ))}
            </div>
          </div>
          <div className="shrink-0 border-t border-line bg-bg/60 px-6 py-4 backdrop-blur-sm">
            <div className="mx-auto max-w-3xl">
              <Composer onSubmit={submit} placeholder="Describe another strategy, or refine this one…" />
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center overflow-hidden px-6 py-12">
          <motion.div
            className="w-full max-w-2xl"
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-7 flex items-start gap-3">
              <span className="mt-0.5 shrink-0">
                <ApolloMark className="h-7 w-7" />
              </span>
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
                  Good to see you.
                </h1>
                <p className="mt-1.5 max-w-md leading-relaxed text-muted">
                  Describe a trading strategy in plain English. I&rsquo;ll build it,
                  backtest it without lookahead bias, and tell you — honestly —
                  whether it holds up.
                </p>
              </div>
            </div>
            <Composer onSubmit={submit} showExamples autoFocus />
          </motion.div>
        </div>
      )}
    </div>
  );
}
