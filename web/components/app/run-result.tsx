"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { ApolloMark } from "@/components/logo";
import { VerdictStamp, Metric } from "@/components/verdict-stamp";
import { EquityArea } from "@/components/equity-spark";
import { AGENT_STEPS, type RunScenario } from "@/lib/mock";

/*
  One run in the thread: the user's prompt, then Apollo streaming its build +
  validation steps, resolving into a verdict card. Mocked timing now; the same
  shape maps onto the API's progress stream + verdict.
*/
export function RunResult({ prompt, scn }: { prompt: string; scn: RunScenario }) {
  const reduce = useReducedMotion() ?? false;
  const [step, setStep] = useState(reduce ? AGENT_STEPS.length : 0);
  const [done, setDone] = useState(reduce);

  useEffect(() => {
    if (reduce) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    AGENT_STEPS.forEach((_, i) => {
      timers.push(setTimeout(() => setStep(i + 1), 480 * (i + 1)));
    });
    timers.push(setTimeout(() => setDone(true), 480 * (AGENT_STEPS.length + 1)));
    return () => timers.forEach(clearTimeout);
  }, [reduce]);

  return (
    <div className="flex flex-col gap-5">
      {/* user prompt */}
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-2xl rounded-tr-sm border border-line bg-elevated px-4 py-2.5 text-[15px] leading-relaxed text-text">
          {prompt}
        </div>
      </div>

      {/* apollo */}
      <div className="flex gap-3">
        <span className="mt-1 shrink-0">
          <ApolloMark className="h-6 w-6" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {!done ? (
            <ul className="flex flex-col gap-2">
              {AGENT_STEPS.map((s, i) => {
                if (i >= step && i !== step) return null;
                const complete = i < step;
                return (
                  <li key={s.label} className="flex items-center gap-2.5 font-mono text-xs">
                    {complete ? (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-pass/15 text-pass">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    )}
                    <span className={complete ? "text-muted" : "text-text"}>{s.label}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              <p className="text-[15px] leading-relaxed text-text-dim">{scn.reply}</p>
              <VerdictCard scn={scn} reduce={reduce} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VerdictCard({ scn, reduce }: { scn: RunScenario; reduce: boolean }) {
  const color = scn.passed ? "var(--color-pass)" : "var(--color-reject)";
  const body = (
    <div className="panel rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
          <span className="text-text">{scn.strategy}</span>
          {scn.params.map((p) => (
            <span key={p.k} className="flex items-center gap-1.5">
              <span className="text-faint">{p.k}</span>
              <span className="text-accent">{p.v}</span>
            </span>
          ))}
        </div>
        <VerdictStamp passed={scn.passed} />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-line bg-bg-soft/50">
        <EquityArea
          values={scn.equity}
          color={color}
          width={560}
          height={130}
          className="h-28 w-full"
          id={`thread-${scn.strategy}`}
          label="held-out equity curve"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-6 border-t border-line pt-4">
        <Metric label="Train Sharpe" value={scn.trainSharpe} tone="muted" />
        <Metric label="Held-out Sharpe" value={scn.testSharpe} tone={scn.passed ? "pass" : "reject"} />
        <Metric label="Retention" value={scn.retention} tone={scn.passed ? "pass" : "reject"} />
        <Metric label="OOS trades" value={scn.oosTrades} tone="text" />
      </div>

      <p className="mt-4 font-mono text-xs leading-relaxed text-muted">
        <span className="text-text-dim">verdict:</span> {scn.reason}
      </p>
    </div>
  );

  if (reduce) return body;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {body}
    </motion.div>
  );
}
