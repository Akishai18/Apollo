/*
  Mock data for the landing page, shaped like the real API's Verdict so wiring
  to the FastAPI backend later is a swap, not a rewrite. Numbers chosen to tell
  the honest story: a strategy that holds up, and one that gets rejected.
*/

export type Verdict = {
  passed: boolean;
  reason: string;
  trainSharpe: number;
  testSharpe: number;
  retention: number; // 0..1
  oosTrades: number;
  windows: number;
};

export const PASS_VERDICT: Verdict = {
  passed: true,
  reason:
    "held-out Sharpe 1.30 retains 60% of train Sharpe 2.16 across 4 walk-forward windows (13 out-of-sample trades)",
  trainSharpe: 2.16,
  testSharpe: 1.3,
  retention: 0.6,
  oosTrades: 13,
  windows: 4,
};

export const REJECT_VERDICT: Verdict = {
  passed: false,
  reason:
    "performance collapses out of sample — held-out Sharpe -1.20 retains -69% of train Sharpe 1.74; the edge looks fitted to the training windows",
  trainSharpe: 1.74,
  testSharpe: -1.2,
  retention: -0.69,
  oosTrades: 9,
  windows: 4,
};

// Example prompts that map to real strategy families — with the verdict Apollo
// would hand back, so the section shows judgement, not just inputs.
export const EXAMPLE_PROMPTS: { prompt: string; passed: boolean }[] = [
  { prompt: "Mean-reversion on AAPL: buy 2σ below the 20-day average, sell at the mean.", passed: true },
  { prompt: "Moving-average crossover on SPY — long when the 50-day crosses above the 200-day.", passed: true },
  { prompt: "Momentum on the Nasdaq 100: weekly, hold the 10 strongest of the last 3 months.", passed: false },
  { prompt: "Mean-reversion on TSLA, max 100 shares, 5% stop loss.", passed: true },
  { prompt: "Pairs trade: KO vs PEP when the spread diverges 2σ.", passed: false },
  { prompt: "Bollinger breakout on BTC, daily, 20-period band.", passed: true },
];

// A smooth-ish equity series for sparklines. `seed` shifts the shape.
function series(seed: number, drift: number, n = 48): number[] {
  const out: number[] = [];
  let v = 100;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin((i + seed) * 0.45) * 2.1 + Math.cos((i + seed) * 0.21) * 1.3;
    v += drift + wave * 0.6;
    out.push(v);
  }
  return out;
}

export const TRAIN_EQUITY = series(0, 0.9);
export const TEST_PASS_EQUITY = series(7, 0.55);
export const TEST_REJECT_EQUITY = series(3, -0.7);

// Apollo's build/validation log, shown in the app preview's agent panel.
export const AGENT_STEPS: { label: string; done: boolean }[] = [
  { label: "Compiled MeanReversion strategy", done: true },
  { label: "Loaded AAPL · 756 daily bars", done: true },
  { label: "Backtested — no lookahead, by construction", done: true },
  { label: "Walk-forward · 4 train/held-out windows", done: true },
  { label: "Swept lookback × entry_z (12 combos)", done: true },
];

// Past strategies in the preview sidebar.
export const SIDEBAR_STRATEGIES: { name: string; passed: boolean }[] = [
  { name: "AAPL mean-reversion", passed: true },
  { name: "SPY 50/200 crossover", passed: true },
  { name: "NQ momentum, weekly", passed: false },
  { name: "TSLA reversion, 5% stop", passed: true },
  { name: "Gold breakout, ATR", passed: false },
];

// Strategy threads in the app sidebar (each thread is a strategy + its verdict).
export type StrategyThread = {
  id: string;
  name: string;
  state: "passed" | "rejected" | "running";
  when: string;
  group: "Today" | "Yesterday" | "Earlier";
};

export const APP_STRATEGIES: StrategyThread[] = [
  { id: "btc-trend", name: "BTC trend · daily", state: "running", when: "now", group: "Today" },
  { id: "aapl-mr", name: "AAPL mean-reversion", state: "passed", when: "2h ago", group: "Today" },
  { id: "spy-x", name: "SPY 50/200 crossover", state: "passed", when: "yesterday", group: "Yesterday" },
  { id: "nq-mom", name: "NQ momentum · weekly", state: "rejected", when: "yesterday", group: "Yesterday" },
  { id: "tsla-mr", name: "TSLA reversion · 5% stop", state: "passed", when: "2d ago", group: "Earlier" },
  { id: "gold-atr", name: "Gold ATR breakout", state: "rejected", when: "3d ago", group: "Earlier" },
];

// A continuous equity curve with a defined in-sample → held-out regime change.
// `inDrift`/`outDrift` set the per-bar trend before/after the split.
function equityCurve(inDrift: number, outDrift: number, seed: number, n = 64, splitFrac = 0.58) {
  const out: number[] = [];
  let v = 100;
  const split = Math.floor(n * splitFrac);
  for (let i = 0; i < n; i++) {
    const drift = i < split ? inDrift : outDrift;
    const wave = Math.sin((i + seed) * 0.5) * 1.4 + Math.cos((i + seed) * 0.23) * 0.9;
    v += drift + wave * 0.5;
    out.push(Number(v.toFixed(2)));
  }
  return out;
}

export const SPLIT_FRAC = 0.58;

export type Sweep = {
  rowLabel: string;
  colLabel: string;
  rows: string[];
  cols: string[];
  values: number[][]; // sharpe-like; rows × cols
  best: [number, number];
};

// A full mocked run result the workspace produces from a prompt (shaped to mirror
// the API verdict). Cycled through as the user submits prompts.
export type RunScenario = {
  strategy: string;
  params: { k: string; v: string }[];
  passed: boolean;
  reason: string;
  reply: string;
  metrics: {
    sharpeTrain: string;
    sharpeTest: string;
    retention: string;
    oosReturn: string;
    maxDrawdown: string;
    winRate: string;
    oosTrades: string;
    windows: number;
  };
  equity: number[];
  splitFrac: number; // fraction of the equity curve that is in-sample
  windowBars: { train: number; test: number }[]; // per walk-forward window
  sweep: Sweep;
};

export const RUN_SCENARIOS: RunScenario[] = [
  {
    strategy: "MeanReversion",
    params: [
      { k: "symbol", v: "AAPL" },
      { k: "lookback", v: "20" },
      { k: "entry_z", v: "-2.0" },
    ],
    passed: true,
    reason:
      "held-out Sharpe 1.30 retains 60% of train Sharpe 2.16 across 4 walk-forward windows (13 out-of-sample trades).",
    reply: "It holds up out of sample — the edge survives data the tuning never saw. Here’s the report.",
    metrics: {
      sharpeTrain: "2.16",
      sharpeTest: "1.30",
      retention: "60%",
      oosReturn: "+18.4%",
      maxDrawdown: "-7.1%",
      winRate: "58%",
      oosTrades: "13",
      windows: 4,
    },
    equity: equityCurve(0.85, 0.52, 2),
    splitFrac: SPLIT_FRAC,
    windowBars: [
      { train: 2.1, test: 1.4 },
      { train: 2.3, test: 1.2 },
      { train: 1.9, test: 1.35 },
      { train: 2.25, test: 1.25 },
    ],
    sweep: {
      rowLabel: "lookback",
      colLabel: "entry_z",
      rows: ["10", "20", "30"],
      cols: ["-2.5", "-2.0", "-1.5", "-1.0"],
      // broad green region → robust, not a single lucky cell
      values: [
        [0.9, 1.5, 1.3, 0.7],
        [1.6, 2.1, 1.8, 1.1],
        [1.2, 1.7, 1.4, 0.8],
      ],
      best: [1, 1],
    },
  },
  {
    strategy: "Momentum",
    params: [
      { k: "universe", v: "NDX" },
      { k: "lookback", v: "63" },
      { k: "top_n", v: "10" },
    ],
    passed: false,
    reason:
      "performance collapses out of sample — held-out Sharpe -1.20 retains -69% of train Sharpe 1.74; the edge looks fitted to the training windows.",
    reply: "I’d pass on this. It looked great in-sample but collapses out of sample — a classic overfit.",
    metrics: {
      sharpeTrain: "1.74",
      sharpeTest: "-1.20",
      retention: "-69%",
      oosReturn: "-11.2%",
      maxDrawdown: "-19.6%",
      winRate: "41%",
      oosTrades: "9",
      windows: 4,
    },
    equity: equityCurve(0.95, -0.95, 5),
    splitFrac: SPLIT_FRAC,
    windowBars: [
      { train: 1.8, test: -0.9 },
      { train: 1.6, test: -1.4 },
      { train: 1.9, test: -0.7 },
      { train: 1.7, test: -1.8 },
    ],
    sweep: {
      rowLabel: "lookback",
      colLabel: "top_n",
      rows: ["21", "63", "126"],
      cols: ["5", "10", "15", "20"],
      // one isolated hot cell surrounded by cold → overfit signature
      values: [
        [-0.4, 0.1, -0.6, -0.3],
        [0.2, 1.7, -0.2, -0.5],
        [-0.5, -0.1, -0.4, -0.7],
      ],
      best: [1, 1],
    },
  },
  {
    strategy: "MaCrossover",
    params: [
      { k: "symbol", v: "SPY" },
      { k: "fast", v: "50" },
      { k: "slow", v: "200" },
    ],
    passed: true,
    reason:
      "held-out Sharpe 1.05 retains 54% of train Sharpe 1.38 across 4 walk-forward windows (7 out-of-sample trades).",
    reply: "This one holds up — modest but real out-of-sample performance.",
    metrics: {
      sharpeTrain: "1.38",
      sharpeTest: "1.05",
      retention: "54%",
      oosReturn: "+9.7%",
      maxDrawdown: "-8.8%",
      winRate: "52%",
      oosTrades: "7",
      windows: 4,
    },
    equity: equityCurve(0.7, 0.42, 9),
    splitFrac: SPLIT_FRAC,
    windowBars: [
      { train: 1.4, test: 1.0 },
      { train: 1.5, test: 0.9 },
      { train: 1.3, test: 1.1 },
      { train: 1.35, test: 1.05 },
    ],
    sweep: {
      rowLabel: "fast",
      colLabel: "slow",
      rows: ["20", "50", "100"],
      cols: ["100", "150", "200", "250"],
      values: [
        [0.6, 0.9, 1.0, 0.7],
        [0.9, 1.2, 1.38, 1.1],
        [0.7, 1.0, 1.15, 0.95],
      ],
      best: [1, 2],
    },
  },
];

// Example prompts offered in the workspace composer.
export const COMPOSER_EXAMPLES: string[] = [
  "Mean-reversion on AAPL — buy 2σ below the 20-day average, exit at the mean.",
  "Moving-average crossover on SPY — long when the 50-day crosses above the 200-day.",
  "Momentum on the Nasdaq 100 — weekly, hold the 10 strongest of the last 3 months.",
  "Bollinger breakout on BTC, daily, 20-period band.",
];

// Strategy archetypes for the launchpad — clickable starting points.
export type Template = {
  key: string;
  name: string;
  blurb: string;
  prompt: string;
};

export const TEMPLATES: Template[] = [
  {
    key: "mean-reversion",
    name: "Mean reversion",
    blurb: "Fade extremes back to the average.",
    prompt: "Mean-reversion on AAPL — buy 2σ below the 20-day average, exit at the mean.",
  },
  {
    key: "momentum",
    name: "Momentum",
    blurb: "Ride the strongest names.",
    prompt: "Momentum on the Nasdaq 100 — weekly, hold the 10 strongest of the last 3 months.",
  },
  {
    key: "crossover",
    name: "Trend crossover",
    blurb: "Follow moving-average trends.",
    prompt: "Moving-average crossover on SPY — long when the 50-day crosses above the 200-day.",
  },
  {
    key: "breakout",
    name: "Breakout",
    blurb: "Trade range expansions.",
    prompt: "Bollinger breakout on BTC, daily, 20-period band.",
  },
];

// Header/launchpad summary stats (mock) — gives the workspace a dashboard pulse.
export const WORKSPACE_STATS = {
  validated: 24,
  passed: 14,
  passRate: "58%",
};

// Live verdict ticker — recent validations scrolling under the hero.
export const TICKER: { name: string; passed: boolean; note: string }[] = [
  { name: "AAPL mean-reversion", passed: true, note: "retains 62%" },
  { name: "NQ momentum · weekly", passed: false, note: "collapses out of sample" },
  { name: "SPY 50/200 crossover", passed: true, note: "Sharpe 1.18 oos" },
  { name: "Gold ATR breakout", passed: false, note: "fitted to 2021" },
  { name: "TSLA reversion · 5% stop", passed: true, note: "retains 55%" },
  { name: "EURUSD carry", passed: false, note: "no edge out of sample" },
  { name: "BTC trend · daily", passed: true, note: "Sharpe 0.94 oos" },
  { name: "Pairs: KO / PEP", passed: false, note: "overfit to the spread" },
];

// A short chat exchange for the agent panel.
export const CHAT = {
  user: "Mean-reversion on AAPL — buy 2σ below the 20-day average, exit at the mean.",
  reply:
    "Built it and stress-tested it across 4 walk-forward windows. It holds up out of sample — the edge survives data the tuning never saw.",
};

// Build an SVG path string for a value series mapped into [0,w] x [0,h].
export function sparkPath(values: number[], w: number, h: number, pad = 2): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  return values
    .map((val, i) => {
      const x = pad + i * step;
      const y = h - pad - ((val - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
