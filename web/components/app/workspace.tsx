"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Download, Plus, Loader2, ArrowUpRight } from "lucide-react";
import { ApolloMark } from "@/components/logo";
import { EvidencePanel } from "./evidence-panel";
import { verdictToReport } from "@/lib/report";
import {
  askStrategyQuestion,
  submitGeneration,
  streamRun,
  DEFAULT_TIER,
  type ApiVerdict,
  type GenerationContext,
  type RunSnapshot,
} from "@/lib/api";
import type { RunScenario } from "@/lib/mock";
import { useRuns } from "@/lib/runs-context";

type Phase = "generating" | "running" | "done" | "error";

type ChatTurn = {
  role: "user" | "apollo";
  text: string;
};

type Active = {
  apiId?: string;
  prompt: string;
  phase: Phase;
  turns: ChatTurn[];
  lastInteraction?: "run" | "chat";
  chatPending?: boolean;
  progress?: { completed: number; total: number } | null;
  note?: string;
  source?: string | null;
  adapter?: string | null;
  verdict?: ApiVerdict | null;
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
const REFINE_PLACEHOLDER =
  'Ask for a change — e.g. "make entries stricter and reduce drawdown"';
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

function refinementContext(active: Active | null): GenerationContext | undefined {
  if (!active?.source) return undefined;
  return {
    source: active.source,
    prompt: active.prompt,
    note: active.note,
  };
}

function appendApolloTurn(turns: ChatTurn[], text: string): ChatTurn[] {
  return [...turns, { role: "apollo", text }];
}

function isRevisionRequest(prompt: string): boolean {
  return /^(make|add|change|remove|try|use|switch|tune|optimi[sz]e|reduce|increase|tighten|loosen|rewrite|update|revise|replace|include|exclude)\b/i.test(
    prompt.trim(),
  );
}

function isQuestionAboutActiveStrategy(prompt: string, active: Active | null): boolean {
  if (!active?.report || active.phase === "generating" || active.phase === "running") return false;
  if (isRevisionRequest(prompt)) return false;
  const p = prompt.trim().toLowerCase();
  return (
    p.endsWith("?") ||
    /^(why|what|how|where|when|which|explain|analy[sz]e|diagnose|summari[sz]e|tell me|show me)\b/.test(
      p,
    ) ||
    /\b(fail|fails|failed|reject|rejected|cause|causes|profitable|drawdown|sharpe|trades|risk|edge|overfit)\b/.test(
      p,
    )
  );
}

function answerStrategyQuestion(question: string, active: Active): string {
  const report = active.report;
  if (!report) return "I need a completed preview before I can analyze the strategy.";

  const q = question.toLowerCase();
  const m = report.metrics;
  const adapterNote =
    active.adapter === "toy"
      ? "\n\nOne important product note: this preview is still running on the toy synthetic adapter, so the ticker name is not real SLS market data yet. Once the market-data adapter is connected, this same question should be answered against actual SLS candles."
      : "";

  if (/\b(fail|fails|failed|reject|rejected|cause|causes|not profitable|why)\b/.test(q)) {
    return [
      `It failed because the validation gate did not find a durable edge: ${report.reason}`,
      "",
      `The key numbers are train Sharpe ${m.sharpeTrain}, held-out Sharpe ${m.sharpeTest}, edge retained ${m.retention}, out-of-sample return ${m.oosReturn}, max drawdown ${m.maxDrawdown}, and ${m.oosTrades} held-out trades across ${m.windows} windows.`,
      "",
      "Practically, that means the entry and exit rules were not producing enough positive expectancy even before we got to the serious out-of-sample question. For a moving-average style strategy, common causes are late entries, whipsaw in range-bound price action, too few clean trends, and exits that give back gains before the gate can confirm a stable edge.",
      adapterNote.trim(),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (/\b(improve|fix|better|profitable|change|try)\b/.test(q)) {
    return [
      "The next useful revisions would be specific and testable: add a volatility filter, require trend confirmation, use a stop or time exit, reduce whipsaw with a wider slow/fast gap, or switch from trend following to mean reversion if the series is range-bound.",
      "",
      "Ask me for one concrete change, for example: “add an ATR volatility filter,” “make exits faster,” or “try mean reversion instead.” I’ll revise the code and run the gate again.",
      adapterNote.trim(),
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Here is the current read: ${report.reason}`,
    "",
    `Train Sharpe is ${m.sharpeTrain}, held-out Sharpe is ${m.sharpeTest}, retention is ${m.retention}, out-of-sample return is ${m.oosReturn}, max drawdown is ${m.maxDrawdown}, and the gate saw ${m.oosTrades} held-out trades across ${m.windows} windows.`,
    "",
    "You can ask why it passed or failed, what to change, where the risk is, or ask for a concrete revision and I’ll re-run it.",
    adapterNote.trim(),
  ]
    .filter(Boolean)
    .join("\n");
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
      const context = refinementContext(active);
      const turns: ChatTurn[] = active?.turns?.length
        ? [...active.turns, { role: "user", text: p }]
        : [{ role: "user", text: p }];

      setTab("log");
      setActive({
        prompt: p,
        phase: "generating",
        lastInteraction: "run",
        progress: null,
        turns,
        source: context?.source ?? null,
        adapter: active?.adapter ?? null,
      });
      setValue("");
      setHasRefinement(false);

      submitGeneration(p, DEFAULT_TIER, context)
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
                      adapter: snap.adapter ?? a.adapter,
                    }
                  : a,
              ),
            onSettled: (snap: RunSnapshot) => {
              setActive((a) => {
                if (!a) return a;
                if (snap.state === "completed" && snap.verdict) {
                  const result = snap.verdict.passed
                    ? `Preview passed: ${snap.verdict.reason}`
                    : `Preview rejected: ${snap.verdict.reason}`;
                  const reply = snap.note ? `${snap.note}\n\n${result}` : result;
                  return {
                    ...a,
                    phase: "done",
                    passed: snap.verdict.passed,
                    report: verdictToReport(snap.verdict, a.prompt),
                    verdict: snap.verdict,
                    note: snap.note ?? a.note,
                    source: snap.source ?? a.source,
                    adapter: snap.adapter ?? a.adapter,
                    turns: appendApolloTurn(a.turns, reply),
                  };
                }
                const error = snap.error ?? "The run failed.";
                return {
                  ...a,
                  phase: "error",
                  error,
                  turns: appendApolloTurn(a.turns, `I could not finish that revision: ${error}`),
                };
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
                  turns: appendApolloTurn(
                    a.turns,
                    "I could not reach the Apollo API. Start it with: uv run uvicorn green.api:app --port 8000",
                  ),
                }
              : a,
          ),
        );
    },
    [active, refresh],
  );

  const answerQuestion = useCallback(
    (prompt: string) => {
      const p = prompt.trim();
      if (!p || !active?.source) return;
      const source = active.source;
      const snapshot = active;
      setTab("log");
      setValue("");
      setHasRefinement(false);
      setActive((a) =>
        a
          ? {
              ...a,
              lastInteraction: "chat",
              chatPending: true,
              turns: [...a.turns, { role: "user", text: p }],
            }
          : a,
      );

      askStrategyQuestion({
        question: p,
        source,
        prompt: snapshot.prompt,
        note: snapshot.note,
        verdict: snapshot.verdict ?? undefined,
        adapter: snapshot.adapter,
      })
        .then((answer) =>
          setActive((a) =>
            a
              ? {
                  ...a,
                  chatPending: false,
                  turns: appendApolloTurn(a.turns, answer),
                }
              : a,
          ),
        )
        .catch(() =>
          setActive((a) =>
            a
              ? {
                  ...a,
                  chatPending: false,
                  turns: appendApolloTurn(a.turns, answerStrategyQuestion(p, snapshot)),
                }
              : a,
          ),
        );
    },
    [active],
  );

  function onSubmit() {
    if (isQuestionAboutActiveStrategy(value, active)) {
      answerQuestion(value);
    } else {
      build(value);
    }
    taRef.current?.focus();
  }

  const status = statusOf(active);
  const name = active ? truncate(active.prompt, 32) : "untitled";
  const busy = active?.phase === "generating" || active?.phase === "running" || !!active?.chatPending;
  const canRefine = Boolean(active?.source && !busy);
  const questionMode = isQuestionAboutActiveStrategy(value, active);

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
                  placeholder={canRefine ? REFINE_PLACEHOLDER : PLACEHOLDER}
                  className="field-sizing-content max-h-32 w-full resize-none bg-transparent font-mono text-[12px] leading-relaxed text-text-dim placeholder:text-faint focus:outline-none"
                />
                <button
                  onClick={onSubmit}
                  disabled={!value.trim() || busy}
                  className="accent-gradient focusable inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-3 font-mono text-[11px] font-medium uppercase tracking-wider text-accent-ink transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  {questionMode ? "Ask" : canRefine ? "Refine" : "Build"}
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip>⌘K commands</Chip>
              <Chip>+ add symbol</Chip>
              <Chip>templates</Chip>
              <Chip>fast sandbox preview</Chip>
              <Chip>promote to validation</Chip>
              {canRefine && <Chip>revision context active</Chip>}
              {questionMode && <Chip>question mode</Chip>}
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
  const visibleTurns =
    active.lastInteraction === "chat"
      ? active.turns
      : active.turns.length > 1
        ? active.turns.slice(0, -1)
        : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      {visibleTurns.length > 0 && (
        <div className="mb-3 space-y-2">
          {visibleTurns.map((turn, i) => (
            <div
              key={`${turn.role}-${i}`}
              className={`rounded border p-3 ${
                turn.role === "user"
                  ? "border-accent/25 bg-accent/5"
                  : "border-line bg-surface"
              }`}
            >
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                {turn.role === "user" ? "You" : "Apollo"}
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-dim">
                {turn.text}
              </p>
            </div>
          ))}
          {active.chatPending && (
            <div className="rounded border border-line bg-surface p-3">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                Apollo
              </div>
              <div className="flex items-center gap-2 text-xs leading-relaxed text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                Reading the strategy evidence…
              </div>
            </div>
          )}
        </div>
      )}
      {active.note && active.lastInteraction !== "chat" && (
        <div className="mb-3 flex gap-3 rounded border border-line bg-surface p-3">
          <ApolloMark className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-xs leading-relaxed text-text-dim">{active.note}</p>
        </div>
      )}
      {active.lastInteraction !== "chat" && (
        <div className="rounded border border-line bg-bg-soft/40 p-3 font-mono text-[12px] leading-relaxed">
          {lines.map((l, i) => (
            <div key={i} className={`flex items-start gap-2 ${toneClass(l.tone)}`}>
              {l.spin && <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-accent" />}
              <span className="whitespace-pre-wrap break-words">{l.text}</span>
            </div>
          ))}
        </div>
      )}
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
