"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Bookmark, Share2, RotateCcw } from "lucide-react";
import { VerdictStamp } from "@/components/verdict-stamp";
import { EquityReport, WindowBars, SweepHeatmap, MetricTile } from "./report-viz";
import { type RunScenario } from "@/lib/mock";

/*
  The validation report — Apollo's signature artifact. A verdict isn't a one-liner
  here; it's an inspectable report: headline + metric tiles + tabbed evidence
  (equity, walk-forward windows, parameter sweep) + the legible reasoning.
*/
const TABS = ["Equity", "Windows", "Sweep"] as const;
type Tab = (typeof TABS)[number];

export function VerdictReport({ scn }: { scn: RunScenario }) {
  const reduce = useReducedMotion() ?? false;
  const [tab, setTab] = useState<Tab>("Equity");
  const tone = scn.passed ? "pass" : "reject";
  const m = scn.metrics;

  return (
    <div className="panel overflow-hidden rounded-2xl">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-display text-base font-semibold text-text">{scn.strategy}</span>
            <span className="font-mono text-xs text-faint">
              {scn.params.map((p) => `${p.k} ${p.v}`).join("  ·  ")}
            </span>
          </div>
          <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed text-muted">
            <span className="text-text-dim">verdict:</span> {scn.reason}
          </p>
        </div>
        <VerdictStamp passed={scn.passed} />
      </div>

      {/* metric tiles */}
      <div className="grid grid-cols-2 gap-2.5 p-5 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Held-out Sharpe" value={m.sharpeTest} tone={tone} hint={`train ${m.sharpeTrain}`} />
        <MetricTile label="Retention" value={m.retention} tone={tone} hint="of train" />
        <MetricTile label="OOS return" value={m.oosReturn} tone={tone} />
        <MetricTile label="Max drawdown" value={m.maxDrawdown} tone="muted" />
        <MetricTile label="Win rate" value={m.winRate} tone="text" />
        <MetricTile label="OOS trades" value={m.oosTrades} tone="text" hint={`${m.windows} windows`} />
      </div>

      {/* tabbed evidence */}
      <div className="px-5">
        <div className="inline-flex rounded-lg border border-line bg-bg-soft/50 p-0.5">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`focusable relative rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                tab === t ? "text-text" : "text-muted hover:text-text"
              }`}
            >
              {tab === t && (
                <motion.span
                  layoutId={`tab-${scn.strategy}`}
                  className="absolute inset-0 rounded-md bg-white/[0.07]"
                  transition={{ duration: reduce ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
              <span className="relative">{t}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-[230px] p-5 pt-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            {tab === "Equity" && (
              <div className="rounded-xl border border-line bg-bg-soft/40 p-3">
                <EquityReport
                  values={scn.equity}
                  splitFrac={scn.splitFrac}
                  tone={tone}
                  id={`eq-${scn.strategy}`}
                />
              </div>
            )}

            {tab === "Windows" && (
              <div className="rounded-xl border border-line bg-bg-soft/40 p-5">
                <div className="mb-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
                  <span>Sharpe per walk-forward window</span>
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-[2px] bg-muted" /> train
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-[2px] ${scn.passed ? "bg-pass" : "bg-reject"}`} />{" "}
                      held-out
                    </span>
                  </span>
                </div>
                <WindowBars windows={scn.windowBars} tone={tone} />
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">
                  {scn.passed
                    ? "Held-out bars track train across every window — the edge is consistent, not a fluke of one period."
                    : "Held-out bars flip negative while train stays high — the edge only existed in the windows it was tuned on."}
                </p>
              </div>
            )}

            {tab === "Sweep" && (
              <div className="rounded-xl border border-line bg-bg-soft/40 p-5">
                <div className="mb-4 font-mono text-[10px] uppercase tracking-wider text-faint">
                  Parameter sweep · train Sharpe
                </div>
                <SweepHeatmap sweep={scn.sweep} />
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">
                  {scn.passed
                    ? "A broad region performs well — the result is robust to parameter choice, not balanced on a knife’s edge."
                    : "Only one cell shines while its neighbours collapse — performance hinges on an exact, lucky parameter set."}
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* footer actions */}
      <div className="flex items-center gap-1 border-t border-line px-3 py-2.5">
        <ReportAction icon={<Bookmark className="h-3.5 w-3.5" />} label="Save" />
        <ReportAction icon={<RotateCcw className="h-3.5 w-3.5" />} label="Re-run" />
        <ReportAction icon={<Share2 className="h-3.5 w-3.5" />} label="Share" />
      </div>
    </div>
  );
}

function ReportAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="focusable inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-white/[0.06] hover:text-text">
      {icon}
      {label}
    </button>
  );
}
