import type { ReactNode } from "react";
import { WalkForward, LookaheadStrip } from "./walk-forward";
import { Reveal } from "./reveal";

function PromptMini() {
  return (
    <div className="rounded-lg border border-line bg-bg-soft/60 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-text-dim">
      buy 2&sigma; below the 20-day average
      <span className="ml-0.5 inline-block h-3 w-[2px] translate-y-0.5 animate-pulse bg-accent align-middle" />
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Describe it",
    body: "Write what you want in plain English. Apollo compiles it into a real, parameterized strategy — no code required.",
    visual: <PromptMini />,
  },
  {
    n: "02",
    title: "We build & backtest it",
    body: "It runs on real data through a simulator where future prices physically don't exist. Lookahead bias is impossible, not just discouraged.",
    visual: <LookaheadStrip className="h-12" />,
  },
  {
    n: "03",
    title: "We try to break it",
    body: "Apollo tunes on past windows, then judges on data it never saw. An edge that only worked in hindsight gets caught here.",
    visual: <WalkForward />,
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id="how"
      className="relative scroll-mt-20 border-t border-line bg-bg/70 py-20 backdrop-blur-sm sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionEyebrow index="01">How it works</SectionEyebrow>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Three steps from a sentence to a strategy you can trust.
          </h2>
        </Reveal>

        <div className="relative mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {/* connecting flow line behind the cards (desktop) */}
          <div
            className="pointer-events-none absolute left-0 right-0 top-[42px] hidden h-px bg-gradient-to-r from-transparent via-line-strong to-transparent md:block"
            aria-hidden="true"
          />
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 0.08}>
              <div className="panel panel-hover group relative flex h-full flex-col gap-5 rounded-2xl p-7">
                <div className="flex items-center gap-3">
                  <span className="nums flex h-9 w-9 items-center justify-center rounded-full border border-line-strong bg-bg-soft text-sm font-semibold text-accent">
                    {step.n}
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <h3 className="font-display text-xl font-semibold text-text">{step.title}</h3>
                <p className="text-[0.95rem] leading-relaxed text-muted">{step.body}</p>
                <div className="mt-auto pt-2">{step.visual}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SectionEyebrow({
  children,
  index,
}: {
  children: ReactNode;
  index?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5 font-mono text-xs uppercase tracking-[0.18em] text-muted">
      {index && <span className="text-accent">{index}</span>}
      <span className="h-px w-6 bg-accent/60" />
      {children}
    </span>
  );
}
