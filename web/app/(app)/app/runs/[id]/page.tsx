"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, RotateCcw, Download, Pencil, ShieldCheck, WandSparkles } from "lucide-react";
import {
  BacktestReport,
  ReportHeader,
  reportMeta,
  HeaderButton,
} from "@/components/app/backtest-report";
import { getRun, streamRun, submitGeneration, validateRun, type RunSnapshot, DEFAULT_TIER } from "@/lib/api";
import { useRuns } from "@/lib/runs-context";

const LAB_PREFILL_KEY = "apollo:lab-source";
const REFINE_PROMPT_KEY = "apollo:refine-prompt";

function reportTitle(snap: RunSnapshot): string {
  const sym = snap.symbol && snap.symbol.toUpperCase() !== "SYN" ? snap.symbol.toUpperCase() : null;
  const kind = snap.kind ?? "strategy";
  if (snap.prompt) return snap.prompt.length > 64 ? `${snap.prompt.slice(0, 63)}…` : snap.prompt;
  if (sym) return `${sym} ${kind}`;
  return kind;
}

export default function RunResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { refresh } = useRuns();
  const [snap, setSnap] = useState<RunSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");
  const [validating, setValidating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    getRun(id)
      .then((s) => {
        if (cancelled) return;
        setSnap(s);
        setStatus("ok");
        if (s.state !== "completed" && s.state !== "error") {
          dispose = streamRun(id, {
            onSnapshot: (n) => setSnap(n),
            onSettled: (n) => {
              setSnap(n);
              void refresh();
            },
          });
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [id, refresh]);

  const rerun = useCallback(() => {
    if (!snap?.prompt) return;
    setActionError(null);
    void submitGeneration(snap.prompt, DEFAULT_TIER)
      .then(({ id: newId }) => {
        void refresh();
        router.push(`/app/runs/${newId}`);
      })
      .catch(() => {
        setActionError("Could not start a rerun. Check that the API is running.");
      });
  }, [snap, refresh, router]);

  const openInLab = useCallback(() => {
    if (snap?.source) sessionStorage.setItem(LAB_PREFILL_KEY, snap.source);
    router.push("/app/backtest");
  }, [snap, router]);

  const promoteToValidation = useCallback(async () => {
    if (!snap?.id || snap.run_kind === "validation") return;
    setValidating(true);
    setActionError(null);
    try {
      const { id: newId } = await validateRun(snap.id);
      void refresh();
      router.push(`/app/runs/${newId}`);
    } catch {
      setActionError("Could not start validation from this run.");
    } finally {
      setValidating(false);
    }
  }, [snap, refresh, router]);

  const refineInBuilder = useCallback(() => {
    if (!snap?.verdict || !snap.source) return;
    const prompt = [
      "Refine this trading strategy after validation.",
      "",
      `Validation result: ${snap.verdict.reason}`,
      "",
      "Goals:",
      "- Keep the strategy lookahead-safe.",
      "- Do not hardcode dates, windows, or outcomes.",
      "- Suggest a concrete revision that can be parameter-swept.",
      "",
      "Current strategy source:",
      "```python",
      snap.source,
      "```",
    ].join("\n");
    sessionStorage.setItem(REFINE_PROMPT_KEY, prompt);
    router.push("/app");
  }, [snap, router]);

  const live = snap && (snap.state === "queued" || snap.state === "running" || snap.state === "generating");

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5">
        {status === "loading" && <p className="font-mono text-sm text-faint">Loading run…</p>}
        {status === "missing" && (
          <div className="panel rounded-2xl p-10 text-center">
            <p className="text-sm text-muted">Run not found.</p>
          </div>
        )}

        {status === "ok" && snap && (
          <>
            {actionError && (
              <div className="mb-3 rounded border border-reject/25 bg-reject/[0.06] px-3 py-2 font-mono text-xs text-reject">
                {actionError}
              </div>
            )}
            <ReportHeader
              title={reportTitle(snap)}
              meta={reportMeta(snap)}
              passed={snap.verdict?.passed}
              running={!!live}
              actions={
                <>
                  <Link
                    href="/app/strategies"
                    className="focusable mr-1 inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-xs text-muted transition-colors hover:text-text"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Strategies
                  </Link>
                  {snap.symbol && snap.symbol.toUpperCase() !== "SYN" && (
                    <span className="hidden h-8 items-center rounded-lg border border-line bg-elevated px-2 font-mono text-[11px] text-text-dim sm:flex">
                      {snap.symbol.toUpperCase()}
                    </span>
                  )}
                  <HeaderButton onClick={openInLab} disabled={!snap.source} icon={<Pencil className="h-3.5 w-3.5" />}>
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
                  {snap.run_kind === "validation" && snap.verdict?.passed === false && snap.source && (
                    <HeaderButton
                      onClick={refineInBuilder}
                      icon={<WandSparkles className="h-3.5 w-3.5" />}
                    >
                      Refine
                    </HeaderButton>
                  )}
                  <button
                    onClick={rerun}
                    disabled={!snap.prompt}
                    className="accent-gradient focusable inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 font-mono text-xs font-medium uppercase tracking-wider text-accent-ink shadow-lg shadow-accent/25 transition-[filter] hover:brightness-110 disabled:opacity-40"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Re-run
                  </button>
                </>
              }
            />
            <BacktestReport snap={snap} onEditParams={openInLab} />
          </>
        )}
      </div>
    </div>
  );
}
