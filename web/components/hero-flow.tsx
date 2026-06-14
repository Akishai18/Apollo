"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowUp, Sparkles, CornerDownRight } from "lucide-react";
import { ApolloMark } from "./logo";
import { VerdictStamp, Metric } from "./verdict-stamp";
import { EquitySpark } from "./equity-spark";
import { TRAIN_EQUITY, TEST_PASS_EQUITY, TEST_REJECT_EQUITY } from "@/lib/mock";

/*
  The hero's living moment: a prompt types itself, compiles to a strategy, and
  lands on a verdict — then cycles to the next, including an honest REJECTED, so
  the product's range and skepticism show. Keeps the typing the user liked, but
  as an integrated vertical flow rather than a screenshot.
*/

type Scenario = {
  prompt: string;
  strategy: string;
  params: { k: string; v: string }[];
  passed: boolean;
  retention: string;
  sharpe: string;
  equity: number[];
};

const SCENARIOS: Scenario[] = [
  {
    prompt: "Mean-reversion on AAPL — buy 2σ below the 20-day average, exit at the mean.",
    strategy: "MeanReversion",
    params: [
      { k: "symbol", v: "AAPL" },
      { k: "lookback", v: "20" },
      { k: "entry_z", v: "-2.0" },
    ],
    passed: true,
    retention: "60%",
    sharpe: "1.30",
    equity: TEST_PASS_EQUITY,
  },
  {
    prompt: "Momentum on the Nasdaq 100 — weekly, hold the 10 strongest of the last 3 months.",
    strategy: "Momentum",
    params: [
      { k: "universe", v: "NDX" },
      { k: "lookback", v: "63" },
      { k: "top_n", v: "10" },
    ],
    passed: false,
    retention: "-41%",
    sharpe: "-0.88",
    equity: TEST_REJECT_EQUITY,
  },
  {
    prompt: "Moving-average crossover on SPY — long when the 50-day crosses above the 200-day.",
    strategy: "MaCrossover",
    params: [
      { k: "symbol", v: "SPY" },
      { k: "fast", v: "50" },
      { k: "slow", v: "200" },
    ],
    passed: true,
    retention: "54%",
    sharpe: "1.05",
    equity: TEST_PASS_EQUITY,
  },
];

export function HeroFlow() {
  const reduce = useReducedMotion() ?? false;
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState(0); // 0 typing · 1 compiled · 2 verdict
  const scn = SCENARIOS[idx];

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduce) {
      // settle to the final state in a callback (not synchronously in the effect)
      timers.push(setTimeout(() => {
        setTyped(scn.prompt);
        setPhase(2);
      }, 0));
      return () => timers.forEach(clearTimeout);
    }
    timers.push(setTimeout(() => {
      setTyped("");
      setPhase(0);
    }, 0));
    let i = 0;
    const type = setInterval(() => {
      i += 1;
      setTyped(scn.prompt.slice(0, i));
      if (i >= scn.prompt.length) {
        clearInterval(type);
        timers.push(setTimeout(() => setPhase(1), 420));
        timers.push(setTimeout(() => setPhase(2), 1120));
        timers.push(setTimeout(() => setIdx((x) => (x + 1) % SCENARIOS.length), 4600));
      }
    }, 26);
    return () => {
      clearInterval(type);
      timers.forEach(clearTimeout);
    };
  }, [idx, reduce, scn.prompt]);

  return (
    <div className="relative w-full max-w-md lg:ml-auto">
      {/* 1 · prompt */}
      <div className="rounded-2xl border border-line-strong bg-surface/70 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> You
        </div>
        <div className="min-h-12 font-mono text-sm leading-relaxed text-text">
          {typed}
          {phase === 0 && (
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent align-middle" />
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-elevated px-2.5 py-1 font-mono text-[11px] text-text-dim">
            <Sparkles className="h-3 w-3 text-accent" /> Apollo · Validate
          </span>
          <span className="inline-flex h-7 items-center gap-1 rounded-full bg-accent px-2.5 font-mono text-[11px] font-medium text-accent-ink">
            Build <ArrowUp className="h-3 w-3" />
          </span>
        </div>
      </div>

      <Connector />

      {/* 2 · compiled — cascades right */}
      <div className="ml-6">
        <Reveal show={phase >= 1} reduce={!!reduce}>
          <div className="rounded-2xl border border-line-strong bg-surface/70 p-4 backdrop-blur-xl">
            <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
              <ApolloMark className="h-3.5 w-3.5 text-accent" /> compiled
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={idx}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-xs"
              >
                <span className="text-text">{scn.strategy}</span>
                {scn.params.map((p) => (
                  <span key={p.k} className="flex items-center gap-1.5">
                    <span className="text-faint">{p.k}</span>
                    <span className="text-accent">{p.v}</span>
                  </span>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </Reveal>
      </div>

      <Connector indent />

      {/* 3 · verdict — cascades further */}
      <div className="ml-12">
        <Reveal show={phase >= 2} reduce={!!reduce}>
          <div className="rounded-2xl border border-line-strong bg-surface/80 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                Walk-forward verdict
              </span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={idx}
                  initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <VerdictStamp passed={scn.passed} />
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="flex items-end justify-between gap-4">
              <div className="flex gap-5">
                <Metric label="Retention" value={scn.retention} tone={scn.passed ? "pass" : "reject"} />
                <Metric label="Sharpe (oos)" value={scn.sharpe} tone={scn.passed ? "pass" : "reject"} />
              </div>
              <EquitySpark
                values={scn.equity}
                compare={TRAIN_EQUITY}
                color={scn.passed ? "var(--color-pass)" : "var(--color-reject)"}
                width={130}
                height={44}
                className="h-11 w-32"
                label="held-out vs in-sample equity"
              />
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function Connector({ indent = false }: { indent?: boolean }) {
  return (
    <div className={`flex h-6 items-center ${indent ? "ml-6 pl-6" : "pl-6"}`}>
      <CornerDownRight className="h-4 w-4 text-line-strong" />
    </div>
  );
}

function Reveal({
  show,
  reduce,
  children,
}: {
  show: boolean;
  reduce: boolean;
  children: React.ReactNode;
}) {
  if (reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
