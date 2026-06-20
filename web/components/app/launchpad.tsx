"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Waves, TrendingUp, LineChart, Sparkles, ArrowUpRight } from "lucide-react";
import { ApolloMark } from "@/components/logo";
import { Composer } from "./composer";
import { WORKSPACE_STATS } from "@/lib/mock";
import { DEFAULT_TIER, type ApiTemplate, type TierKey } from "@/lib/api";

const ICONS: Record<string, React.ReactNode> = {
  "mean-reversion": <Waves className="h-4 w-4" />,
  crossover: <LineChart className="h-4 w-4" />,
  "buy-and-hold": <TrendingUp className="h-4 w-4" />,
};

/*
  The empty-state launchpad: a greeting, the composer, and the real strategy
  templates (fetched from the API) as one-click starting points, plus a stat pulse.
*/
export function Launchpad({
  templates,
  onSubmit,
}: {
  templates: ApiTemplate[];
  onSubmit: (prompt: string, tier: TierKey, template?: ApiTemplate) => void;
}) {
  const reduce = useReducedMotion() ?? false;
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12">
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
              backtest it without lookahead bias, and tell you — honestly — whether
              it holds up.
            </p>
          </div>
        </div>

        <Composer onSubmit={(p, tier) => onSubmit(p, tier)} autoFocus />

        {templates.length > 0 && (
          <div className="mt-7">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-faint">
              Start from a strategy
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.key}
                  onClick={() => onSubmit(t.prompt, DEFAULT_TIER, t)}
                  className="panel panel-hover focusable group flex items-center gap-3 rounded-xl p-3.5 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                    {ICONS[t.key] ?? <Sparkles className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text">{t.name}</span>
                    <span className="block truncate text-xs text-muted">{t.blurb}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-accent" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-7 flex items-center gap-6 border-t border-line pt-5 font-mono text-xs text-faint">
          <Stat label="validated" value={`${WORKSPACE_STATS.validated}`} />
          <Stat label="passed" value={`${WORKSPACE_STATS.passed}`} tone="pass" />
          <Stat label="pass rate" value={WORKSPACE_STATS.passRate} />
        </div>
      </motion.div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pass" }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`nums text-sm font-semibold ${tone === "pass" ? "text-pass" : "text-text"}`}>
        {value}
      </span>
      <span className="uppercase tracking-wider">{label}</span>
    </span>
  );
}
