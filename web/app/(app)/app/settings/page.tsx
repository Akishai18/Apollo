"use client";

import { Check, Sparkles, Zap } from "lucide-react";
import { PageFrame, PageHeader, FadeUp } from "@/components/app/page-frame";
import { APOLLO_TIERS, type TierKey } from "@/lib/api";
import { useRuns } from "@/lib/runs-context";

// The user's current plan. Static until auth/billing land; the free tier is the
// only one provisioned today. Branded names only — the model behind each is secret.
const CURRENT_PLAN: TierKey = "free";

const PRICES: Record<TierKey, string> = { free: "$0", plus: "$29", pro: "$99" };

// What each plan unlocks — generic capability language, never the model behind it.
const PERKS: Record<TierKey, string[]> = {
  free: ["Natural-language strategies", "Full overfit gate", "Walk-forward validation"],
  plus: ["Everything in Spark", "Sharper, deeper reasoning", "Priority validation queue"],
  pro: ["Everything in Core", "Our most capable model", "Largest parameter sweeps"],
};

export default function SettingsPage() {
  const { runs } = useRuns();
  const currentTier = APOLLO_TIERS.find((t) => t.key === CURRENT_PLAN)!;

  return (
    <PageFrame max="max-w-5xl">
      <PageHeader eyebrow="Account" title="Settings" subtitle="Your account and plan." />

      {/* account */}
      <FadeUp delay={0.05}>
        <section className="panel rounded p-3">
          <div className="flex items-center gap-3">
            <span className="accent-gradient flex h-9 w-9 items-center justify-center rounded font-mono text-sm font-semibold text-accent-ink">
              A
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-base text-text">Akishai</div>
              <div className="font-mono text-xs text-muted">akishais18@gmail.com</div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded border border-accent/20 bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent">
              <Sparkles className="h-3 w-3" /> {currentTier.name}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-line pt-3">
            <Usage label="strategies" value={runs.length} />
            <Usage label="validated" value={runs.filter((r) => r.state === "completed").length} />
            <Usage
              label="passed"
              value={runs.filter((r) => r.state === "completed" && r.passed).length}
            />
          </div>
        </section>
      </FadeUp>

      {/* plans */}
      <FadeUp delay={0.1} className="mt-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Plan</div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {APOLLO_TIERS.map((t) => {
            const current = t.key === CURRENT_PLAN;
            return (
              <div
                key={t.key}
                className={`panel relative flex flex-col rounded p-3 ${
                  current ? "ring-1 ring-accent/50" : ""
                }`}
              >
                {current && (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
                    <span className="absolute right-3 top-3 rounded border border-accent/20 bg-accent/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                      current
                    </span>
                  </>
                )}
                <span className="flex h-8 w-8 items-center justify-center rounded bg-accent/10">
                  <Sparkles className="h-4 w-4 text-accent" />
                </span>
                <div className="mt-3 text-base font-semibold text-text">{t.name}</div>
                <p className="mt-1 min-h-[2.5rem] text-xs leading-relaxed text-muted">{t.blurb}</p>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="nums text-xl font-semibold text-text">{PRICES[t.key]}</span>
                  <span className="font-mono text-xs text-faint">/mo</span>
                </div>
                <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                  {PERKS[t.key].map((perk) => (
                    <li key={perk} className="flex items-start gap-2 text-xs text-text-dim">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                      {perk}
                    </li>
                  ))}
                </ul>
                <button
                  disabled={current}
                  className={`focusable mt-4 inline-flex h-8 items-center justify-center gap-1.5 rounded font-mono text-[11px] font-medium uppercase tracking-wider transition-[filter,background-color] ${
                    current
                      ? "cursor-default border border-line text-faint"
                      : "accent-gradient text-accent-ink hover:brightness-110"
                  }`}
                >
                  {current ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Active
                    </>
                  ) : (
                    <>
                      <Zap className="h-3.5 w-3.5" /> Upgrade
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-3 font-mono text-[11px] text-faint">
          Billing isn&rsquo;t live yet — upgrades are coming soon.
        </p>
      </FadeUp>
    </PageFrame>
  );
}

function Usage({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="nums text-lg font-semibold text-text">{value}</div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">{label}</div>
    </div>
  );
}
