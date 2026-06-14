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
