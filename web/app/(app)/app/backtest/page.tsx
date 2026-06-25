"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Plus, Trash2, FlaskConical, AlertTriangle } from "lucide-react";
import { PageFrame, PageHeader, FadeUp } from "@/components/app/page-frame";
import { getTemplates, submitRun, type ApiTemplate } from "@/lib/api";
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

// "10, 20" → [10, 20]; "SYN" → ["SYN"]. Numeric-looking entries become numbers.
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

export default function BacktestPage() {
  const router = useRouter();
  const { refresh } = useRuns();

  const [templates, setTemplates] = useState<ApiTemplate[]>([]);
  // Prefill from "Open in Lab" (stashed in sessionStorage) if present, else the
  // default. Lazy init avoids a setState-in-effect; the prefill only exists after
  // a client-side navigation, so there's no SSR/hydration mismatch.
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const submit = useCallback(async () => {
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
    const request: Record<string, unknown> = {
      source,
      grid: gridObj,
      adapter: { name: adapter, params: adapterParams },
      train_size: train,
      test_size: test,
      starting_cash: cash,
      select_by: selectBy,
      min_retention: minRetention,
      min_oos_trades: minOosTrades,
    };
    if (className.trim()) request.class_name = className.trim();
    if (step.trim() && Number(step) > 0) request.step = Number(step);

    setSubmitting(true);
    try {
      const { id } = await submitRun(request);
      await refresh();
      router.push(`/app/runs/${id}`);
    } catch {
      setError("Couldn't reach the Apollo API. Is it running on :8000?");
      setSubmitting(false);
    }
  }, [
    source, className, grid, adapter, toy, mdParams, train, test, step, cash, selectBy,
    minRetention, minOosTrades, refresh, router,
  ]);

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Lab"
        title="Backtester"
        icon={<FlaskConical className="h-6 w-6 text-accent" />}
        subtitle="Full control — write the strategy, sweep the grid, set the walk-forward windows."
        action={
          templates.length > 0 ? (
            <select
              onChange={(e) => {
                const t = templates.find((x) => x.key === e.target.value);
                if (t) loadTemplate(t);
              }}
              defaultValue=""
              className="focusable h-9 rounded-full border border-line-strong bg-elevated px-3.5 text-sm text-text-dim"
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
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.45fr_1fr]">
        {/* left: strategy + grid */}
        <FadeUp delay={0.05} className="flex flex-col gap-5">
          {/* code editor with chrome */}
          <div className="panel overflow-hidden rounded-2xl">
            <div className="flex items-center gap-2 border-b border-line bg-bg-soft/50 px-4 py-2.5">
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
              rows={15}
              className="scroll-thin w-full resize-y bg-transparent p-4 font-mono text-xs leading-relaxed text-text-dim focus:outline-none"
            />
            <div className="border-t border-line px-4 py-3">
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

          {/* param grid */}
          <Section title="Parameter grid" hint="swept on train, per window">
            <div className="flex flex-col gap-2">
              {grid.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.key}
                    onChange={(e) =>
                      setGrid((g) => g.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
                    }
                    placeholder="param"
                    className="lab-input w-32 font-mono"
                  />
                  <span className="font-mono text-faint">=</span>
                  <input
                    value={row.values}
                    onChange={(e) =>
                      setGrid((g) => g.map((r, j) => (j === i ? { ...r, values: e.target.value } : r)))
                    }
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
        </FadeUp>

        {/* right: config */}
        <FadeUp delay={0.1} className="flex flex-col gap-5">
          <Section title="Walk-forward windows">
            <div className="grid grid-cols-3 gap-2">
              <NumField label="Train" value={train} onChange={setTrain} />
              <NumField label="Test" value={test} onChange={setTest} />
              <Field label="Step">
                <input
                  value={step}
                  onChange={(e) => setStep(e.target.value)}
                  placeholder="auto"
                  className="lab-input font-mono"
                />
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

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-reject/30 bg-reject/[0.07] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-reject" />
              <p className="font-mono text-xs leading-relaxed text-muted">{error}</p>
            </div>
          )}

          <button
            onClick={submit}
            disabled={submitting}
            className="accent-gradient focusable inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium text-accent-ink shadow-lg shadow-accent/25 transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            <Play className="h-4 w-4" /> {submitting ? "Running…" : "Run backtest"}
          </button>
        </FadeUp>
      </div>
    </PageFrame>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel rounded-2xl p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{title}</span>
        {hint && <span className="font-mono text-[10px] text-faint/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
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
