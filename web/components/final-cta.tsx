import { ButtonLink } from "./button";
import { WalkForward } from "./walk-forward";
import { Reveal } from "./reveal";
import { ArrowRight } from "lucide-react";

export function FinalCta() {
  return (
    <section className="border-t border-line bg-bg/70 px-5 py-24 backdrop-blur-sm sm:px-8">
      <Reveal>
        <div className="panel relative mx-auto max-w-6xl overflow-hidden rounded-3xl px-8 py-16 sm:px-14 sm:py-20">
          {/* accent glows */}
          <div
            className="pointer-events-none absolute -left-24 -top-28 h-80 w-80 rounded-full bg-accent/25 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -bottom-32 right-0 h-72 w-72 rounded-full bg-[#7c4dff]/20 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight text-text sm:text-[2.7rem]">
                Describe your first strategy.
              </h2>
              <p className="mt-4 text-lg text-muted">
                A sentence is all it takes. Apollo handles the rest — and won&rsquo;t
                let a fluke through.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/signup" size="lg" variant="primary">
                  Start building <ArrowRight className="h-4 w-4" />
                </ButtonLink>
                <ButtonLink href="/login" size="lg" variant="outline">
                  Log in
                </ButtonLink>
              </div>
            </div>
            <div className="hidden w-72 shrink-0 lg:block">
              <WalkForward rows={5} />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
