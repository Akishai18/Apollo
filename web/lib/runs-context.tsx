"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { listRuns, type RunSummary } from "@/lib/api";

/*
  Shared run history for the gated app. One fetch of GET /runs, consumed by the
  sidebar and the dashboard; `refresh()` is called by the workspace whenever a run
  settles so new strategies appear without a reload. `reachable` is false when the
  API can't be reached, so consumers can show a "start the API" hint.
*/
type RunsValue = {
  runs: RunSummary[];
  loading: boolean;
  reachable: boolean;
  refresh: () => Promise<void>;
};

const RunsContext = createContext<RunsValue | null>(null);

export function RunsProvider({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [reachable, setReachable] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setRuns(await listRuns());
      setReachable(true);
    } catch {
      setReachable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch once on mount. The setState calls live after `await`, inside an async
  // IIFE — not synchronously in the effect body — so they don't cascade-render.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await listRuns();
        if (active) {
          setRuns(rows);
          setReachable(true);
        }
      } catch {
        if (active) setReachable(false);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <RunsContext.Provider value={{ runs, loading, reachable, refresh }}>
      {children}
    </RunsContext.Provider>
  );
}

export function useRuns(): RunsValue {
  const ctx = useContext(RunsContext);
  if (!ctx) throw new Error("useRuns must be used within <RunsProvider>");
  return ctx;
}
