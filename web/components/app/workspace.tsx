"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Download, Plus, Loader2, ArrowUpRight } from "lucide-react";
import { ApolloMark } from "@/components/logo";
import { EvidencePanel } from "./evidence-panel";
import { verdictToReport } from "@/lib/report";
import { submitGeneration, streamRun, DEFAULT_TIER, type RunSnapshot } from "@/lib/api";
import type { RunScenario } from "@/lib/mock";
import { useRuns } from "@/lib/runs-context";

type Phase = "generating" | "running" | "done" | "error";

type Active = {
  apiId?: string;
  prompt: string;
  phase: Phase;
  progress?: { completed: number; total: number } | null;
  note?: string;
  source?: string | null;
  report?: RunScenario;
  passed?: boolean;
  error?: string;
};

type Tab = "log" | "code";

const EXAMPLES = [
  {
    n: "01",
    cat: "Mean Reversion",
    sub: "AAPL · 2σ band",
    desc: "Buy 2σ below the 20-day average, exit at the mean.",
    prompt: "Mean reversion on AAPL — buy 2σ below the 20-day average and exit at the mean.",
  },
  {
    n: "02",
    cat: "Trend Following",
    sub: "SPY · 50/200 cross",
    desc: "Go long when the 50-day crosses above the 200-day.",
    prompt: "Trend following on SPY — go long when the 50-day crosses above the 200-day.",
  },
  {
    n: "03",
    cat: "Volatility Breakout",
    sub: "Gold · ATR breakout",
    desc: "Enter on a close beyond a 1.5×ATR band.",
    prompt: "Volatility breakout on Gold — enter on a close beyond a 1.5×ATR band.",
  },
  {
    n: "04",
    cat: "Pairs / Stat-Arb",
    sub: "KO / PEP spread",
    desc: "Trade the z-score of a cointegrated spread.",
    prompt: "Pairs trade KO/PEP — trade the z-score of the cointegrated spread.",
  },
];

const PLACEHOLDER =
  'Describe a strategy — e.g. "mean-reversion on AAPL, buy 2σ below the 20-day average"';
const REFINE_PROMPT_KEY = "apollo:refine-prompt";

function consumeRefinementPrompt(): string {
  if (typeof window === "undefined") return "";
  const prompt = sessionStorage.getItem(REFINE_PROMPT_KEY) ?? "";
  if (prompt) sessionStorage.removeItem(REFINE_PROMPT_KEY);
  return prompt;
}

function ignoreRefreshError(err: unknown): void {
  void err;
}

export function Workspace() {
  const { refresh } = useRuns();
  const [active, setActive] = useState<Active | null>(null);
  const [tab, setTab] = useState<Tab>("log");
  const [value, setValue] = useState(consumeRefinementPrompt);
  const [hasRefinement, setHasRefinement] = useState(() => value.length > 0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const build = useCallback(
    (prompt: string) => {
      const p = prompt.trim();
      if (!p) return;
      setTab("log");
      setActive({ prompt: p, phase: "generating", progress: null });
      setValue("");
      setHasRefinement(false);

      submitGeneration(p, DEFAULT_TIER)
        .then(({ id }) => {
          setActive((a) => (a ? { ...a, apiId: id } : a));
          void refresh().catch(ignoreRefreshError);
          streamRun(id, {
            onSnapshot: (snap: RunSnapshot) =>
              setActive((a) =>
                a
                  ? {
                      ...a,
                      phase: snap.state === "generating" ? "generating" : "running",
                      progress: snap.progress,
                      note: snap.note ?? a.note,
                      source: snap.source ?? a.source,
                    }
                  : a,
              ),
            onSettled: (snap: RunSnapshot) => {
              setActive((a) => {
                if (!a) return a;
                if (snap.state === "completed" && snap.verdict) {
                  return {
                    ...a,
                    phase: "done",
                    passed: snap.verdict.passed,
                    report: verdictToReport(snap.verdict, a.prompt),
                    note: snap.note ?? a.note,
                    source: snap.source ?? a.source,
                  };
                }
                return { ...a, phase: "error", error: snap.error ?? "The run failed." };
              });
              void refresh().catch(ignoreRefreshError);
            },
            onError: () =>
              setActive((a) =>
                a && (a.phase === "generating" || a.phase === "running")
                  ? { ...a, phase: "error", error: "Lost connection to the API." }
                  : a,
              ),
          });
        })
        .catch(() =>
          setActive((a) =>
            a
              ? {
                  ...a,
                  phase: "error",
                  error:
                    "Can't reach the Apollo API — start it with: uv run uvicorn green.api:app --port 8000",
                }
              : a,
          ),
        );
    },
    [refresh],
  );

  function onSubmit() {
    build(value);
    taRef.current?.focus();
  }

  const status = statusOf(active);
  const name = active ? truncate(active.prompt, 32) : "untitled";
  const busy = active?.phase === "generating" || active?.phase === "running";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── top bar ───────────────────────────────────────────────── */}
      <header className="flex h-11 shrink-0 items-stretch border-b border-line">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3">
          <span className="truncate font-mono text-[13px] text-faint">
            ~/strategies/ <span className="text-text-dim">{name}</span>
          </span>
          <StatusPill status={status} />
          {active && (
            <button
              onClick={() => {
                setActive(null);
                setTab("log");
              }}
              className="focusable ml-1 inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-faint transition-colors hover:text-text"
            >
              <Plus className="h-3 w-3" /> new
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded border border-line bg-bg-soft/60 p-0.5">
              <TabButton active={tab === "log"} onClick={() => setTab("log")}>
                Build log
              </TabButton>
              <TabButton active={tab === "code"} onClick={() => setTab("code")}>
                Code
              </TabButton>
            </div>
            <button
              disabled={!active?.source}
              className="focusable inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-faint transition-colors enabled:hover:text-text disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
          </div>
        </div>

        <div className="hidden w-[18rem] shrink-0 items-center border-l border-line px-3 xl:w-[21rem] lg:flex">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
            Evidence · <span className="text-muted">out-of-sample</span>
          </span>
        </div>
      </header>

      {/* ── panes ─────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* center */}
        <section className="relative flex min-w-0 flex-1 flex-col">
          <div className="scroll-thin flex-1 overflow-y-auto">
            {!active ? (
              <EmptyState onPick={build} />
            ) : tab === "code" ? (
              <CodeView source={active.source} />
            ) : (
              <BuildLog active={active} />
            )}
          </div>

          {/* composer */}
          <div className="shrink-0 border-t border-line px-3 py-2.5">
            <div className="rounded border border-line bg-surface transition-colors focus-within:border-accent">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="font-mono text-sm text-accent">›</span>
                <textarea
                  ref={taRef}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onSubmit();
                    }
                  }}
                  rows={1}
                  placeholder={PLACEHOLDER}
                  className="field-sizing-content max-h-32 w-full resize-none bg-transparent font-mono text-[12px] leading-relaxed text-text-dim placeholder:text-faint focus:outline-none"
                />
                <button
                  onClick={onSubmit}
                  disabled={!value.trim() || busy}
                  className="accent-gradient focusable inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-3 font-mono text-[11px] font-medium uppercase tracking-wider text-accent-ink transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  Build
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip>⌘K commands</Chip>
              <Chip>+ add symbol</Chip>
              <Chip>templates</Chip>
              <Chip>fast sandbox preview</Chip>
              <Chip>promote to validation</Chip>
              {hasRefinement && <Chip>rejection context loaded</Chip>}
            </div>
          </div>
        </section>

        {/* evidence */}
        <aside className="hidden w-[18rem] shrink-0 border-l border-line xl:w-[21rem] lg:block">
          <EvidencePanel report={active?.report ?? null} busy={!!busy} />
        </aside>
      </div>
    </div>
  );
}

/* ── empty state ─────────────────────────────────────────────────── */
function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex min-h-full flex-col justify-center px-4 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded border border-accent/20 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            Workspace
          </span>
          <h1 className="text-base font-semibold text-text">Describe a strategy to validate</h1>
        </div>
        <p className="mb-4 max-w-2xl font-mono text-[11px] leading-relaxed text-faint">
          Plain English in. Apollo writes the code, runs a sandboxed preview, and saves the strategy for formal validation.
        </p>
      <div className="grid w-full grid-cols-1 gap-1.5 sm:grid-cols-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.n}
            onClick={() => onPick(ex.prompt)}
            className="panel panel-hover group rounded p-3 text-left"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
              {ex.n} · {ex.cat}
            </div>
            <div className="mt-2 text-sm font-medium text-text-dim">{ex.sub}</div>
            <div className="mt-1.5 text-xs leading-relaxed text-muted">{ex.desc}</div>
          </button>
        ))}
      </div>
      </div>
    </div>
  );
}

/* ── build log (terminal) ────────────────────────────────────────── */
function BuildLog({ active }: { active: Active }) {
  const lines: { text: string; tone?: "accent" | "pass" | "reject" | "muted"; spin?: boolean }[] = [];
  lines.push({ text: `› ${active.prompt}`, tone: "accent" });
  if (active.phase === "generating") lines.push({ text: "writing strategy from your description…", spin: true });
  if (active.phase === "running") {
    lines.push({ text: "compiling · sandboxing strategy" });
    const p = active.progress;
    lines.push({
      text: p && p.total > 0 ? `preview gate · slice ${p.completed}/${p.total}` : "preview gate · running…",
      spin: true,
    });
  }
  if (active.phase === "done")
    lines.push(
      { text: "compiling · sandboxing strategy" },
      { text: "preview gate · complete" },
      active.passed
        ? { text: `✓ passed${active.report ? ` — ${active.report.reason}` : ""}`, tone: "pass" }
        : { text: `✗ rejected${active.report ? ` — ${active.report.reason}` : ""}`, tone: "reject" },
    );
  if (active.phase === "error") lines.push({ text: `✗ ${active.error ?? "run failed"}`, tone: "reject" });

  const toneClass = (t?: string) =>
    t === "accent" ? "text-text-dim" : t === "pass" ? "text-pass" : t === "reject" ? "text-reject" : "text-muted";

  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      {active.note && (
        <div className="mb-3 flex gap-3 rounded border border-line bg-surface p-3">
          <ApolloMark className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-xs leading-relaxed text-text-dim">{active.note}</p>
        </div>
      )}
      <div className="rounded border border-line bg-bg-soft/40 p-3 font-mono text-[12px] leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className={`flex items-start gap-2 ${toneClass(l.tone)}`}>
            {l.spin && <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-accent" />}
            <span className="whitespace-pre-wrap break-words">{l.text}</span>
          </div>
        ))}
      </div>
      {active.phase === "done" && active.apiId && (
        <Link
          href={`/app/runs/${active.apiId}`}
          className="focusable mt-4 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-text"
        >
          Open full report <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

/* ── code view ───────────────────────────────────────────────────── */
function CodeView({ source }: { source?: string | null }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      <pre className="scroll-thin overflow-auto rounded border border-line bg-bg-soft/40 p-3 font-mono text-xs leading-relaxed text-text-dim">
        <code>{source ?? "// generation in progress — the strategy will appear here."}</code>
      </pre>
    </div>
  );
}

/* ── small parts ─────────────────────────────────────────────────── */
type Status = { label: string; dot: string; text: string };
function statusOf(active: Active | null): Status {
  if (!active) return { label: "IDLE", dot: "bg-faint", text: "text-muted" };
  if (active.phase === "generating") return { label: "WRITING", dot: "bg-accent animate-pulse", text: "text-accent" };
  if (active.phase === "running") return { label: "TESTING", dot: "bg-accent animate-pulse", text: "text-accent" };
  if (active.phase === "error") return { label: "ERROR", dot: "bg-reject", text: "text-reject" };
  return active.passed
    ? { label: "PASS", dot: "bg-pass", text: "text-pass" }
    : { label: "REJECT", dot: "bg-reject", text: "text-reject" };
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider">
      <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
      <span className={status.text}>{status.label}</span>
    </span>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`focusable rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
        active ? "bg-white/[0.08] text-text" : "text-faint hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-line bg-bg-soft/40 px-2 py-1 font-mono text-[10px] text-faint">
      {children}
    </span>
  );
}

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}
