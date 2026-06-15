"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import { ButtonLink } from "./button";
import { HeroFlow } from "./hero-flow";
import { ShaderBackground } from "./shader-background";

// The benefit phrase cycles — the dynamic, always-changing line.
const PHRASES = ["no code.", "no guesswork.", "no lookahead.", "no overfitting.", "no hindsight."];

export function Hero() {
  const reduce = useReducedMotion() ?? false;
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((p) => (p + 1) % PHRASES.length), 2300);
    return () => clearInterval(t);
  }, [reduce]);

  return (
    <section className="relative isolate overflow-hidden">
      {/* living background: continuously flowing GPU shader + texture */}
      <div className="absolute inset-0 -z-20 bg-bg" aria-hidden="true" />
      <ShaderBackground className="absolute inset-0 -z-20 h-full w-full" />
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-bg via-bg/55 to-transparent"
        aria-hidden="true"
      />
      <div className="grain pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-bg"
        aria-hidden="true"
      />

      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-5 pt-32 pb-24 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pt-36 lg:pb-32">
        {/* left: pitch */}
        <div>
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-line-strong bg-white/[0.03] px-3.5 py-1.5 font-mono text-xs text-text-dim backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            Plain English in. A strategy you can trust out.
          </span>

          <h1 className="font-display text-[2.8rem] font-semibold leading-[1.02] tracking-tight text-text sm:text-6xl lg:text-[4.1rem]">
            Trading strategies with
            <span className="relative mt-1 block h-[1.15em]">
              {reduce ? (
                <span className="text-gradient">no overfitting.</span>
              ) : (
                <AnimatePresence>
                  <motion.span
                    key={i}
                    initial={{ y: "0.5em", opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: "-0.5em", opacity: 0 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className="text-gradient absolute inset-x-0 flex justify-start pb-1"
                  >
                    {PHRASES[i]}
                  </motion.span>
                </AnimatePresence>
              )}
            </span>
          </h1>

          <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">
            Describe a strategy in plain English. Apollo builds it, backtests it
            without lookahead bias, and tells you — honestly — whether it holds up.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink href="/signup" size="lg" variant="primary">
              Start building <ArrowRight className="h-4 w-4" />
            </ButtonLink>
            <ButtonLink href="#how" size="lg" variant="outline">
              <Play className="h-4 w-4" /> See how it works
            </ButtonLink>
          </div>
        </div>

        {/* right: the living prompt → verdict flow */}
        <HeroFlow />
      </div>
    </section>
  );
}
