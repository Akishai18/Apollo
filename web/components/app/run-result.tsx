"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { ApolloMark } from "@/components/logo";
import { VerdictReport } from "./verdict-report";
import { BuildingState } from "./building-state";
import type { Run } from "./workspace";

/*
  One run in the thread: the user's prompt, then Apollo — live build progress
  while running, the rich VerdictReport when done, or a legible error card.
*/
export function RunResult({ run }: { run: Run }) {
  const reduce = useReducedMotion() ?? false;

  return (
    <div className="flex flex-col gap-5">
      {/* user prompt */}
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-2xl rounded-tr-sm border border-line bg-elevated px-4 py-2.5 text-[15px] leading-relaxed text-text">
          {run.prompt}
        </div>
      </div>

      {/* apollo */}
      <div className="flex gap-3">
        <span className="mt-1 shrink-0">
          <ApolloMark className="h-6 w-6" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Apollo's rationale, once generated — shown through validation and after. */}
          {run.note && run.status !== "error" && (
            <p className="text-[15px] leading-relaxed text-text-dim">{run.note}</p>
          )}

          {run.status === "generating" && <BuildingState phase="generating" />}

          {run.status === "building" && <BuildingState progress={run.progress} />}

          {run.status === "error" && (
            <div className="flex max-w-md items-start gap-2.5 rounded-2xl border border-reject/30 bg-reject/[0.07] p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-reject" />
              <div>
                <p className="text-sm font-medium text-text">Couldn’t run this strategy</p>
                <p className="mt-1 font-mono text-xs leading-relaxed text-muted">{run.error}</p>
              </div>
            </div>
          )}

          {run.status === "done" && run.report && (
            <>
              {!run.note && (
                <p className="text-[15px] leading-relaxed text-text-dim">{run.report.reply}</p>
              )}
              <Wrap reduce={reduce}>
                <VerdictReport scn={run.report} />
              </Wrap>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Wrap({ reduce, children }: { reduce: boolean; children: React.ReactNode }) {
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
