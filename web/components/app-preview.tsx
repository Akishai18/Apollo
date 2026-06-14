import { Check, Plus } from "lucide-react";
import { ApolloMark } from "./logo";
import { VerdictStamp, Metric } from "./verdict-stamp";
import { EquityArea } from "./equity-spark";
import { AGENT_STEPS, SIDEBAR_STRATEGIES, CHAT, TEST_PASS_EQUITY } from "@/lib/mock";

/*
  The product, shown not told: a realistic peek at the Apollo builder. A strategy
  on the left, Apollo's agent reasoning + validating on the right, the verdict
  front and centre. Lives in the "Inside the builder" section.
*/

export function AppPreview({ className = "" }: { className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl shadow-black/50 ${className}`}
    >
      {/* window chrome */}
      <div className="flex h-10 items-center gap-2 border-b border-line px-4">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        </span>
        <span className="ml-2 font-mono text-xs text-faint">apollo / builder</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[190px_1fr_250px]">
        {/* sidebar */}
        <aside className="hidden flex-col gap-1 border-r border-line bg-bg-soft/60 p-3 lg:flex">
          <button className="mb-2 inline-flex items-center gap-2 rounded-lg border border-line-strong bg-elevated px-3 py-2 text-left font-mono text-xs text-text-dim">
            <Plus className="h-3.5 w-3.5 text-accent" /> New strategy
          </button>
          {SIDEBAR_STRATEGIES.map((s, i) => (
            <div
              key={s.name}
              className={`flex items-center gap-2 rounded-md px-2.5 py-2 font-mono text-xs ${
                i === 0 ? "bg-white/[0.05] text-text" : "text-muted"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  s.passed ? "bg-pass" : "bg-reject"
                }`}
              />
              <span className="truncate">{s.name}</span>
            </div>
          ))}
        </aside>

        {/* main: the strategy + verdict */}
        <main className="border-r border-line p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-sm font-semibold text-text">
                MeanReversion · AAPL
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-faint">
                lookback 20 · entry_z -2.0 · exit_z 0.0
              </div>
            </div>
            <VerdictStamp passed />
          </div>

          <div className="mt-4 rounded-lg border border-line bg-bg-soft/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                Equity · in-sample vs held-out
              </span>
              <span className="nums text-[11px] text-pass">+18.4%</span>
            </div>
            <EquityArea
              values={TEST_PASS_EQUITY}
              width={440}
              height={120}
              className="h-28 w-full"
              id="preview-eq"
              label="held-out equity curve"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-6">
            <Metric label="Train Sharpe" value="2.16" tone="muted" />
            <Metric label="Held-out Sharpe" value="1.30" tone="pass" />
            <Metric label="Retention" value="60%" tone="pass" />
            <Metric label="OOS trades" value="13" tone="text" />
          </div>
        </main>

        {/* agent panel */}
        <aside className="hidden flex-col gap-3 bg-bg-soft/40 p-4 lg:flex">
          <div className="flex items-start justify-end">
            <p className="max-w-[90%] rounded-xl rounded-tr-sm bg-elevated px-3 py-2 font-mono text-[11px] leading-relaxed text-text-dim">
              {CHAT.user}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-accent">
              <ApolloMark className="h-4 w-4" />
            </span>
            <p className="max-w-[90%] rounded-xl rounded-tl-sm bg-accent/10 px-3 py-2 text-[11px] leading-relaxed text-text">
              {CHAT.reply}
            </p>
          </div>

          <div className="mt-1 border-t border-line pt-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-faint">
              Build log
            </div>
            <ul className="flex flex-col gap-1.5">
              {AGENT_STEPS.map((step) => (
                <li
                  key={step.label}
                  className="flex items-center gap-2 font-mono text-[11px] text-muted"
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-pass/15 text-pass">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                  {step.label}
                </li>
              ))}
              <li className="mt-1 flex items-center gap-2 font-mono text-[11px] text-text">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Verdict: <span className="text-pass">PASS</span> — retains 60%
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
