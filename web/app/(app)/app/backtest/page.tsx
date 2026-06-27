"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Play,
  Plus,
  Trash2,
  Trash,
  RotateCcw,
  Download,
  SlidersHorizontal,
  AlertTriangle,
  Pencil,
  ChevronLeft,
  ShieldCheck,
} from "lucide-react";
import {
  BacktestReport,
  ReportHeader,
  reportMeta,
  HeaderButton,
} from "@/components/app/backtest-report";
import {
  createDraft,
  createStrategy,
  createVersion,
  getTemplates,
  runVersion,
  streamRun,
  validateRun,
  type ApiTemplate,
  type RunSnapshot,
} from "@/lib/api";
import { useRuns } from "@/lib/runs-context";

const LAB_PREFILL_KEY = "apollo:lab-source";

type GridRow = { key: string; values: string };

const DEFAULT_GRID: GridRow[] = [
  { key: "symbol", values: "SYN" },
  { key: "lookback", values: "10, 20" },
  { key: "entry_z", values: "-1.5, -1.0" },
  { key: "quantity", values: "500" },
];

const DEFAULT_SOURCE = `from green.core import Order, Side, Strategy


class MeanReversion(Strategy):
    def on_tick(self, view):
        return []
`;

function coerceList(values: string): (number | string)[] {
  return values
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const n = Number(p);
      return p !== "" && !Number.isNaN(n) ? n : p;
    });
}

function gridPointCount(grid: GridRow[]): number {
  return grid.reduce((total, row) => {
    const count = coerceList(row.values).length;
    return total * Math.max(count, 1);
  }, 1);
}

function reportTitle(snap: RunSnapshot): string {
  const sym = snap.symbol && snap.symbol.toUpperCase() !== "SYN" ? snap.symbol.toUpperCase() : null;
  const kind = snap.kind ?? "strategy";
  if (sym) return `${sym} ${kind}`;
  return snap.prompt ?? kind;
}

function strategyTitle(className: string, grid: Record<string, (number | string)[]>): string {
  const symbol = typeof grid.symbol?.[0] === "string" ? String(grid.symbol[0]).toUpperCase() : null;
  const klass = className.trim() || "Strategy";
  const label = klass.replace(/([A-Z])/g, " $1").trim();
  return symbol && symbol !== "SYN" ? `${symbol} ${label}` : label;
}

export default function BacktestPage() {
  const router = useRouter();
  const { refresh } = useRuns();

  const [templates, setTemplates] = useState<ApiTemplate[]>([]);
  const [source, setSource] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SOURCE;
    const prefill = sessionStorage.getItem(LAB_PREFILL_KEY);
    if (prefill) {
      sessionStorage.removeItem(LAB_PREFILL_KEY);
      return prefill;
    }
    return DEFAULT_SOURCE;
  });
  const [className, setClassName] = useState("");
  const [grid, setGrid] = useState<GridRow[]>(DEFAULT_GRID);
  const [adapter, setAdapter] = useState<"toy" | "market_data">("toy");
  const [toy, setToy] = useState({ n_steps: 600, mu: 100, theta: 0.1, sigma: 1, seed: 7 });
  const [mdParams, setMdParams] = useState("{}");
  const [train, setTrain] = useState(200);
  const [test, setTest] = useState(100);
  const [step, setStep] = useState("");
  const [cash, setCash] = useState(100000);
  const [selectBy, setSelectBy] = useState<"sharpe" | "total_return">("sharpe");
  const [minRetention, setMinRetention] = useState(0.5);
  const [minOosTrades, setMinOosTrades] = useState(2);

  const [configOpen, setConfigOpen] = useState(true);
  const [snap, setSnap] = useState<RunSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [strategyId, setStrategyId] = useState<string | null>(null);

  useEffect(() => {
    getTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  const loadTemplate = useCallback((t: ApiTemplate) => {
    const req = t.request as Record<string, unknown>;
    if (typeof req.source === "string") setSource(req.source);
    if (typeof req.class_name === "string") setClassName(req.class_name);
    const g = req.grid as Record<string, unknown[]> | undefined;
    if (g) setGrid(Object.entries(g).map(([key, vals]) => ({ key, values: vals.join(", ") })));
    if (typeof req.train_size === "number") setTrain(req.train_size);
    if (typeof req.test_size === "number") setTest(req.test_size);
    const ad = req.adapter as { name?: string; params?: Record<string, number> } | undefined;
    if (ad?.name === "toy" && ad.params) setToy((prev) => ({ ...prev, ...ad.params }));
  }, []);

  const busy = snap?.state === "queued" || snap?.state === "running" || snap?.state === "generating";

  const run = useCallback(async () => {
    setError(null);
    let adapterParams: Record<string, unknown> = toy;
    if (adapter === "market_data") {
      try {
        adapterParams = JSON.parse(mdParams) as Record<string, unknown>;
      } catch {
        setError("Adapter params must be valid JSON.");
        return;
      }
    }
    const gridObj: Record<string, (number | string)[]> = {};
    for (const row of grid) {
      const k = row.key.trim();
      if (k) gridObj[k] = coerceList(row.values);
    }
    if (Object.keys(gridObj).length === 0) {
      setError("Add at least one parameter to the grid (e.g. symbol = SYN).");
      return;
    }
    const draft = {
      prompt: null,
      rationale: null,
      assumptions: ["Created in Backtester."],
      source,
      class_name: className.trim() || null,
      grid: gridObj,
      adapter: { name: adapter, params: adapterParams },
      train_size: train,
      test_size: test,
      step: step.trim() && Number(step) > 0 ? Number(step) : null,
      starting_cash: cash,
      select_by: selectBy,
      min_retention: minRetention,
      min_oos_trades: minOosTrades,
    };

    setSnap({
      id: "",
      state: "running",
      progress: null,
      verdict: null,
      error: null,
      note: null,
      prompt: null,
      source,
      symbol: typeof gridObj.symbol?.[0] === "string" ? String(gridObj.symbol[0]) : null,
      kind: className ? className.replace(/([A-Z])/g, " $1").trim().toLowerCase() : "strategy",
      run_kind: "backtest",
      train_size: train,
      test_size: test,
      adapter,
    });
    setConfigOpen(false);

    try {
      const strategy =
        strategyId ??
        (
          await createStrategy({
            title: strategyTitle(className, gridObj),
            description: "Created in Backtester.",
          })
        ).id;
      if (!strategyId) setStrategyId(strategy);
      const savedDraft = await createDraft(strategy, draft);
      const version = await createVersion(savedDraft.id);
      const { id } = await runVersion(version.id, "backtest");
      await refresh();
      streamRun(id, {
        onSnapshot: (n) =>
          setSnap({
            ...n,
            train_size: n.train_size ?? train,
            test_size: n.test_size ?? test,
            adapter: n.adapter ?? adapter,
          }),
        onSettled: (n) => {
          setSnap({
            ...n,
            train_size: n.train_size ?? train,
            test_size: n.test_size ?? test,
            adapter: n.adapter ?? adapter,
          });
          void refresh();
        },
        onError: () => setError("Lost connection to the API."),
      });
    } catch {
      setSnap(null);
      setConfigOpen(true);
      setError("Couldn't reach the Apollo API. Is it running on :8000?");
    }
  }, [
    source,
    className,
    grid,
    adapter,
    toy,
    mdParams,
    train,
    test,
    step,
    cash,
    selectBy,
    minRetention,
    minOosTrades,
    refresh,
    strategyId,
  ]);

  const showReport = snap && (busy || snap.verdict || snap.state === "error");

  const promoteToValidation = useCallback(async () => {
    if (!snap?.id || snap.run_kind === "validation") return;
    setValidating(true);
    try {
      const { id } = await validateRun(snap.id);
      await refresh();
      router.push(`/app/runs/${id}`);
    } catch {
      setError("Could not start validation from this backtest.");
    } finally {
      setValidating(false);
    }
  }, [snap, refresh, router]);

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1500px] px-3 py-2.5 sm:px-4">
        {showReport && snap ? (
          <>
            <ReportHeader
              title={reportTitle(snap)}
              meta={reportMeta(snap)}
              passed={snap.verdict?.passed}
              running={busy}
              actions={
                <>
                  <Link
                    href="/app/strategies"
                    className="focusable mr-1 hidden items-center gap-1 rounded px-2 py-1 font-mono text-xs text-muted transition-colors hover:text-text sm:inline-flex"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Strategies
                  </Link>
                  <HeaderButton
                    onClick={() => setConfigOpen(true)}
                    icon={<Pencil className="h-3.5 w-3.5" />}
                  >
                    Edit
                  </HeaderButton>
                  <HeaderButton disabled icon={<Download className="h-3.5 w-3.5" />}>
                    Export
                  </HeaderButton>
                  {snap.run_kind === "backtest" && snap.state === "completed" && (
                    <HeaderButton
                      onClick={promoteToValidation}
                      disabled={validating}
                      icon={<ShieldCheck className="h-3.5 w-3.5" />}
                    >
                      Validate
                    </HeaderButton>
                  )}
                  <button
                    onClick={run}
                    disabled={busy}
                    className="accent-gradient focusable inline-flex h-8 items-center gap-1.5 rounded px-3 font-mono text-[11px] font-medium uppercase tracking-wider text-accent-ink transition-[filter] hover:brightness-110 disabled:opacity-40"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Re-run
                  </button>
                </>
              }
            />
            <BacktestReport snap={snap} onEditParams={() => setConfigOpen(true)} />
          </>
        ) : (
          <LabConfigHeader
            onRun={run}
            busy={busy}
            adapter={adapter}
            train={train}
            test={test}
            gridPoints={gridPointCount(grid)}
          />
        )}

        {configOpen && (
          <div className={`${showReport ? "mt-5 border-t border-line pt-4" : ""}`}>
            {showReport && (
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Configuration</h2>
                <button
                  onClick={() => setConfigOpen(false)}
                  className="focusable rounded px-2 py-1 font-mono text-xs text-muted transition-colors hover:text-text"
                >
                  Close
                </button>
              </div>
            )}
            <ConfigPanel
              source={source}
              setSource={setSource}
              className={className}
              setClassName={setClassName}
              grid={grid}
              setGrid={setGrid}
              templates={templates}
              loadTemplate={loadTemplate}
              adapter={adapter}
              setAdapter={setAdapter}
              toy={toy}
              setToy={setToy}
              mdParams={mdParams}
              setMdParams={setMdParams}
              train={train}
              setTrain={setTrain}
              test={test}
              setTest={setTest}
              step={step}
              setStep={setStep}
              cash={cash}
              setCash={setCash}
              selectBy={selectBy}
              setSelectBy={setSelectBy}
              minRetention={minRetention}
              setMinRetention={setMinRetention}
              minOosTrades={minOosTrades}
              setMinOosTrades={setMinOosTrades}
              error={error}
              onRun={run}
              busy={busy}
              showRunButton={!showReport}
            />
          </div>
        )}

        {!showReport && !configOpen && (
          <div className="panel flex flex-col items-center gap-3 rounded p-8 text-center">
            <p className="text-sm text-muted">Configure a backtest and run it to see the report.</p>
            <button
              onClick={() => setConfigOpen(true)}
              className="focusable inline-flex items-center gap-1.5 rounded border border-line-strong px-3 py-1.5 text-xs text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Configure
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LabConfigHeader({
  onRun,
  busy,
  adapter,
  train,
  test,
  gridPoints,
}: {
  onRun: () => void;
  busy: boolean;
  adapter: "toy" | "market_data";
  train: number;
  test: number;
  gridPoints: number;
}) {
  return (
    <header className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/app/strategies"
          className="focusable hidden h-8 items-center gap-1 rounded border border-line bg-bg-soft/70 px-2.5 font-mono text-[11px] text-muted transition-colors hover:text-text sm:inline-flex"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Strategies
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded border border-accent/20 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
              Lab
            </span>
            <h1 className="truncate text-[15px] font-semibold leading-tight text-text sm:text-base">
              Backtester
            </h1>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-faint">
            {adapter === "market_data" ? "market data" : "synthetic daily bars"} · {train}/{test} split ·{" "}
            {gridPoints} grid {gridPoints === 1 ? "point" : "points"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <HeaderButton disabled icon={<Download className="h-3.5 w-3.5" />}>
          Export
        </HeaderButton>
        <button
          onClick={onRun}
          disabled={busy}
          className="accent-gradient focusable inline-flex h-8 items-center gap-1.5 rounded px-3 font-mono text-[11px] font-medium uppercase tracking-wider text-accent-ink transition-[filter] hover:brightness-110 disabled:opacity-40"
        >
          <Play className="h-3.5 w-3.5" /> Run
        </button>
      </div>
    </header>
  );
}

function ConfigPanel({
  source,
  setSource,
  className,
  setClassName,
  grid,
  setGrid,
  templates,
  loadTemplate,
  adapter,
  setAdapter,
  toy,
  setToy,
  mdParams,
  setMdParams,
  train,
  setTrain,
  test,
  setTest,
  step,
  setStep,
  cash,
  setCash,
  selectBy,
  setSelectBy,
  minRetention,
  setMinRetention,
  minOosTrades,
  setMinOosTrades,
  error,
  onRun,
  busy,
  showRunButton,
}: {
  source: string;
  setSource: (v: string) => void;
  className: string;
  setClassName: (v: string) => void;
  grid: GridRow[];
  setGrid: React.Dispatch<React.SetStateAction<GridRow[]>>;
  templates: ApiTemplate[];
  loadTemplate: (t: ApiTemplate) => void;
  adapter: "toy" | "market_data";
  setAdapter: (v: "toy" | "market_data") => void;
  toy: { n_steps: number; mu: number; theta: number; sigma: number; seed: number };
  setToy: (v: { n_steps: number; mu: number; theta: number; sigma: number; seed: number }) => void;
  mdParams: string;
  setMdParams: (v: string) => void;
  train: number;
  setTrain: (v: number) => void;
  test: number;
  setTest: (v: number) => void;
  step: string;
  setStep: (v: string) => void;
  cash: number;
  setCash: (v: number) => void;
  selectBy: "sharpe" | "total_return";
  setSelectBy: (v: "sharpe" | "total_return") => void;
  minRetention: number;
  setMinRetention: (v: number) => void;
  minOosTrades: number;
  setMinOosTrades: (v: number) => void;
  error: string | null;
  onRun: () => void;
  busy: boolean;
  showRunButton: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3 rounded border border-accent/20 bg-accent/[0.045] px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
          Preflight
        </span>
        <p className="min-w-0 text-[12px] leading-relaxed text-text-dim">
          Configure the strategy, sweep the grid on train windows, then judge the chosen params out of sample.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        <PreflightTile label="Adapter" value={adapter === "market_data" ? "Market" : "Toy"} sub="data source" />
        <PreflightTile label="Train" value={String(train)} sub="bars / window" />
        <PreflightTile label="Test" value={String(test)} sub="held-out bars" />
        <PreflightTile label="Grid" value={String(gridPointCount(grid))} sub="parameter runs" />
        <PreflightTile label="Cash" value={`$${cash.toLocaleString()}`} sub="starting equity" />
        <PreflightTile label="Gate" value={`${Math.round(minRetention * 100)}%`} sub="min retained" tone="accent" />
      </div>

      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="panel overflow-hidden rounded">
            <div className="flex items-center gap-2 border-b border-line bg-bg-soft/50 px-3 py-2">
            <span className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-reject/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-accent/40" />
              <span className="h-2.5 w-2.5 rounded-full bg-pass/50" />
            </span>
            <span className="ml-1 font-mono text-[11px] text-muted">strategy.py</span>
            <span className="ml-auto font-mono text-[10px] text-faint">{source.length} chars</span>
          </div>
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            rows={16}
            className="scroll-thin w-full resize-y bg-transparent p-3 font-mono text-[12px] leading-relaxed text-text-dim focus:outline-none"
          />
          <div className="border-t border-line px-3 py-2.5">
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">
                Class name — only needed if the source defines more than one strategy
              </span>
              <input
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="auto-detected"
                className="lab-input font-mono"
              />
            </label>
          </div>
        </div>

        <Section title="Parameter grid" hint="swept on train, per window">
          <div className="flex flex-col gap-2">
            {grid.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={row.key}
                  onChange={(e) => setGrid((g) => g.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
                  placeholder="param"
                  className="lab-input w-32 font-mono"
                />
                <span className="font-mono text-faint">=</span>
                <input
                  value={row.values}
                  onChange={(e) => setGrid((g) => g.map((r, j) => (j === i ? { ...r, values: e.target.value } : r)))}
                  placeholder="comma, separated, values"
                  className="lab-input flex-1 font-mono"
                />
                <button
                  onClick={() => setGrid((g) => g.filter((_, j) => j !== i))}
                  className="focusable rounded-md p-2 text-faint transition-colors hover:text-reject"
                  aria-label="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setGrid((g) => [...g, { key: "", values: "" }])}
              className="focusable mt-1 inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:text-text"
            >
              <Plus className="h-3.5 w-3.5" /> Add parameter
            </button>
          </div>
        </Section>
      </div>

        <aside className="flex flex-col gap-2.5">
        <div className="panel rounded p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Template</span>
            <button
              onClick={() => {
                setSource(DEFAULT_SOURCE);
                setClassName("");
                setGrid(DEFAULT_GRID);
              }}
              className="focusable inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 font-mono text-[10px] uppercase tracking-wider text-faint transition-colors hover:text-text"
            >
              <Trash className="h-3 w-3" /> Reset
            </button>
          </div>
          {templates.length > 0 ? (
            <select
              onChange={(e) => {
                const t = templates.find((x) => x.key === e.target.value);
                if (t) loadTemplate(t);
              }}
              defaultValue=""
              className="lab-input font-mono"
            >
              <option value="" disabled>
                Load a template…
              </option>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="font-mono text-[11px] text-faint">templates unavailable</p>
          )}
        </div>

        <Section title="Walk-forward windows">
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Train" value={train} onChange={setTrain} />
            <NumField label="Test" value={test} onChange={setTest} />
            <Field label="Step">
              <input value={step} onChange={(e) => setStep(e.target.value)} placeholder="auto" className="lab-input font-mono" />
            </Field>
          </div>
        </Section>

        <Section title="Data adapter">
          <select
            value={adapter}
            onChange={(e) => setAdapter(e.target.value as "toy" | "market_data")}
            className="lab-input mb-2"
          >
            <option value="toy">toy — synthetic OU series</option>
            <option value="market_data">market_data</option>
          </select>
          {adapter === "toy" ? (
            <div className="grid grid-cols-2 gap-2">
              <NumField label="n_steps" value={toy.n_steps} onChange={(v) => setToy({ ...toy, n_steps: v })} />
              <NumField label="seed" value={toy.seed} onChange={(v) => setToy({ ...toy, seed: v })} />
              <NumField label="mu" value={toy.mu} onChange={(v) => setToy({ ...toy, mu: v })} step="any" />
              <NumField label="theta" value={toy.theta} onChange={(v) => setToy({ ...toy, theta: v })} step="any" />
              <NumField label="sigma" value={toy.sigma} onChange={(v) => setToy({ ...toy, sigma: v })} step="any" />
            </div>
          ) : (
            <Field label="Params (JSON)">
              <textarea
                value={mdParams}
                onChange={(e) => setMdParams(e.target.value)}
                rows={4}
                spellCheck={false}
                className="lab-input font-mono"
              />
            </Field>
          )}
        </Section>

        <Section title="Gate">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Select by">
              <select
                value={selectBy}
                onChange={(e) => setSelectBy(e.target.value as "sharpe" | "total_return")}
                className="lab-input"
              >
                <option value="sharpe">sharpe</option>
                <option value="total_return">total_return</option>
              </select>
            </Field>
            <NumField label="Starting cash" value={cash} onChange={setCash} step="any" />
            <NumField label="Min retention" value={minRetention} onChange={setMinRetention} step="any" />
            <NumField label="Min OOS trades" value={minOosTrades} onChange={setMinOosTrades} />
          </div>
        </Section>

        <PreflightChecklist adapter={adapter} gridPoints={gridPointCount(grid)} minOosTrades={minOosTrades} />

        {error && (
          <div className="flex items-start gap-2.5 rounded border border-reject/30 bg-reject/[0.07] p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-reject" />
            <p className="font-mono text-xs leading-relaxed text-muted">{error}</p>
          </div>
        )}

        {showRunButton && (
          <button
            onClick={onRun}
            disabled={busy}
            className="accent-gradient focusable inline-flex h-8 items-center justify-center gap-2 rounded font-mono text-[11px] font-medium uppercase tracking-wider text-accent-ink transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            <Play className="h-4 w-4" /> {busy ? "Running…" : "Run backtest"}
          </button>
        )}
        </aside>
      </div>
    </div>
  );
}

function PreflightTile({
  label,
  value,
  sub,
  tone = "text",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "text" | "accent";
}) {
  return (
    <div className="panel rounded px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">{label}</div>
      <div className={`nums mt-1 truncate text-base font-semibold leading-none ${tone === "accent" ? "text-accent" : "text-text"}`}>
        {value}
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-faint">{sub}</div>
    </div>
  );
}

function PreflightChecklist({
  adapter,
  gridPoints,
  minOosTrades,
}: {
  adapter: "toy" | "market_data";
  gridPoints: number;
  minOosTrades: number;
}) {
  const rows = [
    ["Lookahead boundary", "structural"],
    ["Adapter fills", adapter === "market_data" ? "next open" : "synthetic"],
    ["Sweep coverage", `${gridPoints} cells`],
    ["Evidence floor", `${minOosTrades} trades`],
  ];
  return (
    <div className="panel rounded p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-text">Integrity scan</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-pass">ready</span>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="text-muted">{label}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-pass">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="panel rounded p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">{title}</span>
        {hint && <span className="font-mono text-[10px] text-faint/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] text-muted">{label}</span>
      {children}
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="lab-input font-mono"
      />
    </Field>
  );
}
