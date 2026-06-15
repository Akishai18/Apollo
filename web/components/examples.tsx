import Link from "next/link";
import { SectionEyebrow } from "./how-it-works";
import { Reveal } from "./reveal";
import { VerdictStamp } from "./verdict-stamp";
import { EXAMPLE_PROMPTS } from "@/lib/mock";
import { ArrowRight } from "lucide-react";

/*
  Range + judgement, shown not told: real prompts, each with the verdict Apollo
  hands back (some PASS, some REJECTED). Reinforces both "just describe it" and
  "we'll tell you the truth".
*/
export function Examples() {
  return (
    <section
      id="examples"
      className="scroll-mt-20 border-t border-line bg-bg/70 py-20 backdrop-blur-sm sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionEyebrow index="04">What you can build</SectionEyebrow>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            If you can say it, Apollo can test it.
          </h2>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {EXAMPLE_PROMPTS.map((ex, i) => (
            <Reveal key={i} delay={(i % 2) * 0.06}>
              <div className="panel panel-hover group flex h-full flex-col justify-between gap-5 rounded-2xl p-5">
                <p className="font-mono text-sm leading-relaxed text-text-dim">
                  <span className="mr-2 text-accent">&rsaquo;</span>
                  {ex.prompt}
                </p>
                <div className="flex items-center justify-between">
                  <VerdictStamp passed={ex.passed} />
                  <span className="font-mono text-[11px] text-faint transition-colors group-hover:text-text-dim">
                    walk-forward
                  </span>
                </div>
              </div>
            </Reveal>
          ))}

          {/* build-your-own cell */}
          <Reveal delay={0.06} className="sm:col-span-2">
            <Link
              href="/signup"
              className="group flex items-center justify-between gap-4 rounded-2xl border border-dashed border-line-strong bg-surface/40 p-6 transition-colors hover:border-accent/60 focusable"
            >
              <span className="font-display text-lg font-medium text-text">
                Describe your own &mdash; it&rsquo;s free to try.
              </span>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-ink transition-transform group-hover:translate-x-0.5">
                <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
