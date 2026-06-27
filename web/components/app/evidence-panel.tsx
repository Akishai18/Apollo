"use client";

import { VerdictStamp } from "@/components/verdict-stamp";
import { EquityReport, WindowBars, SweepHeatmap, MetricTile } from "./report-viz";
import type { RunScenario } from "@/lib/mock";

/*
  The right-hand EVIDENCE panel. Empty → a hatched placeholder + prompt. While a
  run is in flight → a quiet "validating" state. Done → the out-of-sample evidence
  stacked vertically for the narrow column: verdict, equity, metrics, windows, sweep.
*/
export function EvidencePanel({
  report,
  busy,
}: {
  report: RunScenario | null;
  busy: boolean;
}) {
  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4">
        <div
          className="mb-4 h-36 w-full rounded border border-dashed border-line-strong"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--color-line) 0, var(--color-line) 1px, transparent 1px, transparent 11px)",
          }}
          aria-hidden="true"
        />
        <p className="max-w-[16rem] text-center font-mono text-[11px] leading-relaxed text-faint">
          {busy
            ? "Running the gate — evidence will appear here the moment it lands."
            : "Run a preview or validation and the out-of-sample evidence appears here — equity curve, metrics, walk-forward windows and integrity checks."}
        </p>
      </div>
    );
  }

  const tone = report.passed ? "pass" : "reject";
  const m = report.metrics;

  return (
    <div className="scroll-thin flex h-full flex-col gap-3 overflow-y-auto p-3">
      {/* verdict */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wider text-faint">Verdict</div>
          <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted">{report.reason}</p>
        </div>
        <VerdictStamp passed={report.passed} />
      </div>

      <Section label="Equity · in-sample → held-out">
        <div className="rounded border border-line bg-bg-soft/40 p-2">
          <EquityReport values={report.equity} splitFrac={report.splitFrac} tone={tone} id="ev-eq" />
        </div>
      </Section>

      <Section label="Metrics">
        <div className="grid grid-cols-2 gap-1.5">
          <MetricTile label="Held-out Sharpe" value={m.sharpeTest} tone={tone} hint={`train ${m.sharpeTrain}`} />
          <MetricTile label="Retention" value={m.retention} tone={tone} hint="of train" />
          <MetricTile label="OOS return" value={m.oosReturn} tone={tone} />
          <MetricTile label="Max drawdown" value={m.maxDrawdown} tone="muted" />
          <MetricTile label="Win rate" value={m.winRate} tone="text" />
          <MetricTile label="OOS trades" value={m.oosTrades} tone="text" hint={`${m.windows} windows`} />
        </div>
      </Section>

      <Section label="Walk-forward windows">
        <div className="rounded border border-line bg-bg-soft/40 p-2">
          <WindowBars windows={report.windowBars} tone={tone} />
        </div>
      </Section>

      <Section label="Parameter sweep · train Sharpe">
        <div className="rounded border border-line bg-bg-soft/40 p-2">
          <SweepHeatmap sweep={report.sweep} />
        </div>
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
      {children}
    </section>
  );
}
