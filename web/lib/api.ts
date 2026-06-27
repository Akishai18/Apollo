/*
  Client for the Apollo FastAPI backend. The app talks to it over REST and can
  optionally use WebSocket streaming. Local dev can run with auth off; when
  Supabase is configured, every call attaches the current access token.
*/

import { getAccessToken } from "@/lib/supabase";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");
const ENABLE_WS_STREAM = process.env.NEXT_PUBLIC_ENABLE_WS === "1";

// --- API shapes (snake_case, as the backend serialises) --------------------

export type ApiMetrics = {
  total_return: number;
  sharpe: number;
  max_drawdown: number;
  final_equity: number;
  num_fills: number;
  num_trades: number;
  win_rate: number;
  profit_factor: number;
  cagr: number;
  max_dd_bars: number;
};

export type ApiTradeRecord = {
  symbol: string;
  side: "LONG" | "SHORT";
  entry_t: number;
  exit_t: number;
  bars: number;
  pnl_pct: number;
};

export type ApiSweepPoint = { params: Record<string, unknown>; train: ApiMetrics };

export type ApiWindow = {
  window: { train_start: number; train_end: number; test_start: number; test_end: number };
  chosen_params: Record<string, unknown>;
  train: ApiMetrics;
  test: ApiMetrics;
  sweep: ApiSweepPoint[];
  train_dates: string[];
  test_dates: string[];
  train_equity: [number, number][];
  test_equity: [number, number][];
  benchmark_equity: [number, number][];
  test_trades: ApiTradeRecord[];
};

export type ApiVerdict = {
  passed: boolean;
  reason: string;
  train_sharpe: number;
  test_sharpe: number;
  retention: number;
  oos_trades: number;
  windows: ApiWindow[];
};

export type RunState = "queued" | "generating" | "running" | "completed" | "error";
export type RunKind = "backtest" | "validation";

export type RunSnapshot = {
  id: string;
  state: RunState;
  progress: { completed: number; total: number } | null;
  verdict: ApiVerdict | null;
  error: string | null;
  note: string | null; // the generator's rationale (natural-language runs)
  prompt: string | null; // the original NL prompt (natural-language runs)
  source: string | null; // the strategy source that ran (detail view)
  symbol: string | null; // primary traded symbol (from the grid)
  kind: string | null; // strategy family, derived from the class name
  run_kind: RunKind;
  train_size: number | null;
  test_size: number | null;
  adapter: string | null;
};

// Lean row for lists/sidebar (GET /runs) — no full verdict, but enough verdict
// metrics + a downsampled OOS equity spark to render a rich table in one call.
export type RunSummary = {
  id: string;
  state: RunState;
  title: string | null;
  symbol: string | null;
  kind: string | null;
  run_kind: RunKind;
  passed: boolean | null;
  reason: string | null;
  oos_sharpe: number | null;
  edge_retained: number | null;
  max_dd: number | null;
  spark: number[];
  progress: { completed: number; total: number } | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type StrategyRecord = {
  id: string;
  title: string;
  description: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type StrategySummary = StrategyRecord & {
  latest_run: RunSummary | null;
  latest_validation: RunSummary | null;
  versions_count: number;
  runs_count: number;
  promoted: boolean;
};

export type TrackedRun = {
  run_id: string;
  name: string;
  symbol: string | null;
  adapter: string | null;
  run_kind: string | null;
  passed: boolean | null;
  oos_sharpe: number | null;
  retention: number | null;
  oos_trades: number | null;
  created_at: number; // epoch ms
};

export type StrategyDraft = {
  id: string;
  strategy_id: string;
  prompt: string | null;
  rationale: string | null;
  assumptions: string[];
  source: string;
  class_name: string | null;
  grid: Record<string, unknown[]>;
  adapter: { name: "toy" | "market_data"; params: Record<string, unknown> };
  train_size: number;
  test_size: number;
  step: number | null;
  starting_cash: number;
  select_by: "sharpe" | "total_return";
  min_retention: number;
  min_oos_trades: number;
  created_at: string;
  updated_at: string;
};

export type StrategyVersion = Omit<StrategyDraft, "created_at" | "updated_at"> & {
  draft_id: string;
  version_number: number;
  frozen_at: string;
};

export type StrategyDetail = {
  strategy: StrategyRecord;
  drafts: StrategyDraft[];
  versions: StrategyVersion[];
  runs: RunSummary[];
};

export type GenerationContext = {
  source: string;
  prompt?: string;
  note?: string;
};

export type StrategyQuestionContext = {
  question: string;
  source: string;
  prompt?: string;
  note?: string;
  verdict?: ApiVerdict;
  adapter?: string | null;
};

/*
  Apollo's plans, as the UI presents them. These are BRANDED names only — the
  model behind each tier is a server-side secret and is deliberately never sent
  to or referenced by the client. Keys match the backend tier keys.
*/
export type TierKey = "free" | "plus" | "pro";

export const APOLLO_TIERS: { key: TierKey; name: string; blurb: string }[] = [
  { key: "free", name: "Apollo Spark", blurb: "Fast drafts to get going" },
  { key: "plus", name: "Apollo Core", blurb: "Sharper strategies, deeper reasoning" },
  { key: "pro", name: "Apollo Prime", blurb: "Our most capable model" },
];

// Free tier (Apollo Spark → Gemini) is the only one configured for now; default
// to it so generations route to Gemini rather than a key-less paid tier.
export const DEFAULT_TIER: TierKey = "free";

export type ApiTemplate = {
  key: string;
  name: string;
  blurb: string;
  prompt: string;
  request: Record<string, unknown>;
};

// --- calls -----------------------------------------------------------------

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (error) {
    throw new Error(
      `Apollo API is unreachable at ${API_BASE}. Start the API or fix its environment.`,
      { cause: error },
    );
  }
}

export async function getTemplates(): Promise<ApiTemplate[]> {
  const res = await apiFetch("/templates");
  if (!res.ok) throw new Error(`templates: ${res.status}`);
  return (await res.json()) as ApiTemplate[];
}

export async function createStrategy(body: {
  title: string;
  description?: string;
}): Promise<StrategyRecord> {
  const res = await apiFetch("/strategies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: body.title, description: body.description ?? "" }),
  });
  if (!res.ok) throw new Error(`strategy: ${res.status}`);
  return (await res.json()) as StrategyRecord;
}

export async function listStrategies(): Promise<StrategySummary[]> {
  const res = await apiFetch("/strategies");
  if (!res.ok) throw new Error(`strategies: ${res.status}`);
  return (await res.json()) as StrategySummary[];
}

export async function getStrategy(id: string): Promise<StrategyDetail> {
  const res = await apiFetch(`/strategies/${id}`);
  if (!res.ok) throw new Error(`strategy: ${res.status}`);
  return (await res.json()) as StrategyDetail;
}

export async function createDraft(
  strategyId: string,
  body: Omit<StrategyDraft, "id" | "strategy_id" | "created_at" | "updated_at">,
): Promise<StrategyDraft> {
  const res = await apiFetch(`/strategies/${strategyId}/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`draft: ${res.status}`);
  return (await res.json()) as StrategyDraft;
}

export async function createVersion(draftId: string): Promise<StrategyVersion> {
  const res = await apiFetch(`/drafts/${draftId}/versions`, { method: "POST" });
  if (!res.ok) throw new Error(`version: ${res.status}`);
  return (await res.json()) as StrategyVersion;
}

export async function runVersion(
  versionId: string,
  runKind: RunKind,
): Promise<{ id: string }> {
  const action = runKind === "validation" ? "validate" : "backtest";
  const res = await apiFetch(`/versions/${versionId}/${action}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`version run: ${res.status}`);
  return (await res.json()) as { id: string };
}

// The caller's runs, newest activity first (GET /runs returns lean summaries).
export async function listRuns(): Promise<RunSummary[]> {
  const res = await apiFetch("/runs");
  if (!res.ok) throw new Error(`runs: ${res.status}`);
  const rows = (await res.json()) as RunSummary[];
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// One run with its full verdict + source/prompt (GET /runs/{id}).
export async function getRun(id: string): Promise<RunSnapshot> {
  const res = await apiFetch(`/runs/${id}`);
  if (!res.ok) throw new Error(`run: ${res.status}`);
  return (await res.json()) as RunSnapshot;
}

export type DecayAlert = {
  strategy_id: string;
  title: string;
  symbol: string | null;
  passed: boolean | null;
  oos_sharpe: number | null;
  retention: number | null;
  reason: string;
};

export async function listDecayAlerts(): Promise<DecayAlert[]> {
  const res = await fetch(`${API_BASE}/maintenance/alerts`);
  if (!res.ok) throw new Error(`alerts: ${res.status}`);
  return (await res.json()) as DecayAlert[];
}

export async function listTrackedRuns(): Promise<TrackedRun[]> {
  const res = await fetch(`${API_BASE}/experiments/runs`);
  if (!res.ok) throw new Error(`experiments: ${res.status}`);
  return (await res.json()) as TrackedRun[];
}

export async function revalidatePromoted(): Promise<{ count: number; run_ids: string[] }> {
  const res = await fetch(`${API_BASE}/maintenance/revalidate`, { method: "POST" });
  if (!res.ok) throw new Error(`revalidate: ${res.status}`);
  return (await res.json()) as { count: number; run_ids: string[] };
}

export async function setStrategyPromoted(id: string, promoted: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/strategies/${id}/${promoted ? "promote" : "demote"}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`promote: ${res.status}`);
}

export async function submitRun(request: Record<string, unknown>): Promise<{ id: string }> {
  const res = await apiFetch("/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`submit: ${res.status}`);
  return (await res.json()) as { id: string };
}

export async function validateRun(id: string): Promise<{ id: string }> {
  const res = await apiFetch(`/runs/${id}/validate`, { method: "POST" });
  if (!res.ok) throw new Error(`validate: ${res.status}`);
  return (await res.json()) as { id: string };
}

/*
  Submit a natural-language strategy description. Apollo generates the code
  (the tier picks the model, server-side) and runs it through the same gate.
  Same lifecycle as a run, with an extra `generating` phase up front.
*/
export async function submitGeneration(
  prompt: string,
  tier: TierKey,
  context?: GenerationContext,
): Promise<{ id: string }> {
  const res = await apiFetch("/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, tier, context }),
  });
  if (!res.ok) throw new Error(`generate: ${res.status}`);
  return (await res.json()) as { id: string };
}

export async function askStrategyQuestion(body: StrategyQuestionContext): Promise<string> {
  const res = await apiFetch("/assistant/strategy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`strategy chat: ${res.status}`);
  const payload = (await res.json()) as { answer: string };
  return payload.answer;
}

/*
  Open a WebSocket for live snapshots. Calls onSnapshot for every frame and
  onSettled once on the terminal (completed/error) frame, then closes. Returns a
  disposer. onError fires if the socket itself fails.
*/
export function streamRun(
  id: string,
  handlers: {
    onSnapshot?: (snap: RunSnapshot) => void;
    onSettled?: (snap: RunSnapshot) => void;
    onError?: () => void;
  },
): () => void {
  let settled = false;
  let disposed = false;
  let polling = false;
  let failures = 0;
  let pollTimer: number | null = null;
  let ws: WebSocket | null = null;

  const handleSnapshot = (snap: RunSnapshot) => {
    if (disposed || !snap.state || settled) return;
    handlers.onSnapshot?.(snap);
    if (snap.state === "completed" || snap.state === "error") {
      settled = true;
      handlers.onSettled?.(snap);
      ws?.close();
      if (pollTimer) window.clearTimeout(pollTimer);
    }
  };

  const poll = () => {
    if (disposed || settled) return;
    pollTimer = window.setTimeout(() => {
      getRun(id)
        .then((snap) => {
          failures = 0;
          handleSnapshot(snap);
          poll();
        })
        .catch(() => {
          failures += 1;
          if (failures >= 3) {
            handlers.onError?.();
            return;
          }
          poll();
        });
    }, 900);
  };

  const startPolling = () => {
    if (polling || disposed || settled) return;
    polling = true;
    poll();
  };

  if (!ENABLE_WS_STREAM) {
    startPolling();
  } else {
    getAccessToken()
      .then((token) => {
        if (disposed || settled) return;
        const query = token ? `?token=${encodeURIComponent(token)}` : "";
        ws = new WebSocket(`${WS_BASE}/runs/${id}/ws${query}`);
        ws.onmessage = (event) => {
          let snap: RunSnapshot;
          try {
            snap = JSON.parse(event.data as string) as RunSnapshot;
          } catch {
            return;
          }
          handleSnapshot(snap); // ignores non-snapshot frames, e.g. {detail}
        };

        ws.onerror = () => {
          startPolling();
        };

        ws.onclose = () => {
          if (!settled) startPolling();
        };
      })
      .catch(() => startPolling());
  }

  return () => {
    disposed = true;
    ws?.close();
    if (pollTimer) window.clearTimeout(pollTimer);
  };
}
