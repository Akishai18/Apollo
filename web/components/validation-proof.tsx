import { SectionEyebrow } from "./how-it-works";
import { Reveal } from "./reveal";
import { VerdictStamp, Metric } from "./verdict-stamp";
import { EquityArea } from "./equity-spark";
import {
  PASS_VERDICT,
  REJECT_VERDICT,
  TEST_PASS_EQUITY,
  TEST_REJECT_EQUITY,
  type Verdict,
} from "@/lib/mock";

/*
  Validation is the supporting proof, not the headline: two real verdicts side
  by side — one holds up, one is rejected with a legible reason. The trust kicker.
*/
export function ValidationProof() {
  return (
    <section
      id="validation"
      className="scroll-mt-20 border-t border-line bg-bg-soft/65 py-20 backdrop-blur-sm sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionEyebrow index="03">Why you can trust the result</SectionEyebrow>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Most backtests lie. Apollo tells you when yours does.
          </h2>
          <p className="mt-5 max-w-2xl text-[1.05rem] leading-relaxed text-muted">
            Every strategy is judged on data its tuning never touched. If the edge
            was just fitted to the past, the verdict says so — in plain language.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Reveal>
            <VerdictCard verdict={PASS_VERDICT} test={TEST_PASS_EQUITY} />
          </Reveal>
          <Reveal delay={0.08}>
            <VerdictCard verdict={REJECT_VERDICT} test={TEST_REJECT_EQUITY} />
          </Reveal>
        </div>

        {/* a quiet stat line for weight */}
        <Reveal delay={0.1}>
          <p className="mt-8 font-mono text-xs text-faint">
            Across recent runs, roughly <span className="text-reject">1 in 3</span> strategies that
            looked great in-sample were <span className="text-reject">rejected</span> out of sample.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function VerdictCard({ verdict, test }: { verdict: Verdict; test: number[] }) {
  const sign = verdict.testSharpe >= 0 ? "" : "-";
  const sharpe = `${sign}${Math.abs(verdict.testSharpe).toFixed(2)}`;
  const color = verdict.passed ? "var(--color-pass)" : "var(--color-reject)";
  return (
    <div className="panel panel-hover flex h-full flex-col rounded-2xl p-6">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-faint">
          Walk-forward · {verdict.windows} windows
        </span>
        <VerdictStamp passed={verdict.passed} />
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-line bg-bg-soft/50">
        <EquityArea
          values={test}
          color={color}
          width={520}
          height={140}
          className="h-32 w-full"
          id={verdict.passed ? "vp-pass" : "vp-reject"}
          label={verdict.passed ? "held-out equity holds up" : "held-out equity collapses"}
        />
      </div>

      <div className="mt-5 flex gap-7 border-t border-line pt-5">
        <Metric label="Train Sharpe" value={verdict.trainSharpe.toFixed(2)} tone="muted" />
        <Metric label="Held-out Sharpe" value={sharpe} tone={verdict.passed ? "pass" : "reject"} />
        <Metric
          label="Retention"
          value={`${Math.round(verdict.retention * 100)}%`}
          tone={verdict.passed ? "pass" : "reject"}
        />
      </div>

      <p className="mt-5 font-mono text-xs leading-relaxed text-muted">
        <span className="text-text-dim">verdict:</span> {verdict.reason}
      </p>
    </div>
  );
}
