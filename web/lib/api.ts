/*
  Client for the Apollo FastAPI backend. The app talks to it over REST (submit /
  fetch) + WebSocket (live progress). Auth is off in local dev (the API resolves a
  fixed dev user), so no token is needed yet; when Supabase auth lands, attach the
  bearer token here.
*/

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");

// --- API shapes (snake_case, as the backend serialises) --------------------

export type ApiMetrics = {
  total_return: number;
  sharpe: number;
  max_drawdown: number;
  final_equity: number;
  num_fills: number;
  num_trades: number;
  win_rate: number;
};

export type ApiSweepPoint = { params: Record<string, unknown>; train: ApiMetrics };

export type ApiWindow = {
  window: { train_start: number; train_end: number; test_start: number; test_end: number };
  chosen_params: Record<string, unknown>;
  train: ApiMetrics;
  test: ApiMetrics;
  sweep: ApiSweepPoint[];
  train_equity: [number, number][];
  test_equity: [number, number][];
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

export type RunSnapshot = {
  id: string;
  state: RunState;
  progress: { completed: number; total: number } | null;
  verdict: ApiVerdict | null;
  error: string | null;
  note: string | null; // the generator's rationale (natural-language runs)
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

export const DEFAULT_TIER: TierKey = "pro";

export type ApiTemplate = {
  key: string;
  name: string;
  blurb: string;
  prompt: string;
  request: Record<string, unknown>;
};

// --- calls -----------------------------------------------------------------

export async function getTemplates(): Promise<ApiTemplate[]> {
  const res = await fetch(`${API_BASE}/templates`);
  if (!res.ok) throw new Error(`templates: ${res.status}`);
  return (await res.json()) as ApiTemplate[];
}

export async function submitRun(request: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`submit: ${res.status}`);
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
): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, tier }),
  });
  if (!res.ok) throw new Error(`generate: ${res.status}`);
  return (await res.json()) as { id: string };
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
  const ws = new WebSocket(`${WS_BASE}/runs/${id}/ws`);

  ws.onmessage = (event) => {
    let snap: RunSnapshot;
    try {
      snap = JSON.parse(event.data as string) as RunSnapshot;
    } catch {
      return;
    }
    if (!snap.state) return; // ignore non-snapshot frames (e.g. {detail})
    handlers.onSnapshot?.(snap);
    if (snap.state === "completed" || snap.state === "error") {
      settled = true;
      handlers.onSettled?.(snap);
      ws.close();
    }
  };

  ws.onerror = () => {
    if (!settled) handlers.onError?.();
  };

  return () => ws.close();
}
