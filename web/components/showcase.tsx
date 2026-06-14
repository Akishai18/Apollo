import { AppPreview } from "./app-preview";
import { SectionEyebrow } from "./how-it-works";
import { Reveal } from "./reveal";

/*
  The real workspace, shown once — after the steps explain the idea. Keeps the
  detailed builder out of the hero (so the hero isn't a screenshot dump) while
  still proving the product is real.
*/
export function Showcase() {
  return (
    <section
      id="builder"
      className="scroll-mt-20 border-t border-line bg-bg/70 py-20 backdrop-blur-sm sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <div className="max-w-2xl">
            <SectionEyebrow index="02">Inside the builder</SectionEyebrow>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
              Your whole workflow, in one place.
            </h2>
            <p className="mt-5 text-[1.05rem] leading-relaxed text-muted">
              Every strategy you describe becomes a tracked run. Watch Apollo build
              and validate it in real time, then keep a history of what held up — and
              what didn&rsquo;t.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08} className="relative mt-12">
          <AppPreview />
          <div
            className="pointer-events-none absolute -inset-x-6 -bottom-10 -z-10 h-44 bg-accent/10 blur-3xl"
            aria-hidden="true"
          />
        </Reveal>
      </div>
    </section>
  );
}
