"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  Code2,
  Copy,
  Check,
  RotateCcw,
  FlaskConical,
  AlertTriangle,
} from "lucide-react";
import { VerdictReport } from "@/components/app/verdict-report";
import { BuildingState } from "@/components/app/building-state";
import { VerdictStamp } from "@/components/verdict-stamp";
import { ApolloMark } from "@/components/logo";
import { PageFrame, FadeUp } from "@/components/app/page-frame";
import { verdictToReport } from "@/lib/report";
import { getRun, streamRun, submitGeneration, type RunSnapshot, DEFAULT_TIER } from "@/lib/api";
import { useRuns } from "@/lib/runs-context";

const LAB_PREFILL_KEY = "apollo:lab-source";

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { refresh } = useRuns();
  const [snap, setSnap] = useState<RunSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");
  const [windowIdx, setWindowIdx] = useState<number | null>(null);

  // Fetch once; if the run is still live, stream it to completion.
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
            onSnapshot: (next) => setSnap(next),
            onSettled: (next) => {
              setSnap(next);
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

  const verdict = snap?.verdict ?? null;
  const title = snap?.prompt ?? "Strategy";
  const windowCount = verdict?.windows.length ?? 0;
  const selected = windowIdx ?? (windowCount > 0 ? windowCount - 1 : 0);

  const report = useMemo(
    () => (verdict ? verdictToReport(verdict, title, selected) : null),
    [verdict, title, selected],
  );

  const rerun = useCallback(() => {
    if (!snap?.prompt) return;
    void submitGeneration(snap.prompt, DEFAULT_TIER).then(({ id: newId }) => {
      void refresh();
      router.push(`/app/runs/${newId}`);
    });
  }, [snap, refresh, router]);

  const openInLab = useCallback(() => {
    if (snap?.source) sessionStorage.setItem(LAB_PREFILL_KEY, snap.source);
    router.push("/app/backtest");
  }, [snap, router]);

  const live = snap && (snap.state === "queued" || snap.state === "running");

  return (
    <PageFrame max="max-w-4xl">
      <FadeUp>
        <Link
          href="/app/strategies"
          className="focusable mb-6 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All strategies
        </Link>
      </FadeUp>

      {status === "loading" && <p className="font-mono text-sm text-faint">Loading run…</p>}
      {status === "missing" && (
        <div className="panel rounded-2xl p-10 text-center">
          <p className="text-sm text-muted">Run not found.</p>
        </div>
      )}

      {status === "ok" && snap && (
        <>
          {/* header */}
          <FadeUp delay={0.04} className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent/80">
                Validation report
              </div>
              <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-text">
                {title}
              </h1>
            </div>
            {snap.state === "completed" && verdict && <VerdictStamp passed={verdict.passed} />}
          </FadeUp>

          {/* rationale, spoken by Apollo */}
          {snap.note && (
            <FadeUp delay={0.06}>
              <div className="mb-6 flex gap-3">
                <ApolloMark className="mt-0.5 h-6 w-6 shrink-0" />
                <p className="max-w-2xl text-[15px] leading-relaxed text-text-dim">{snap.note}</p>
              </div>
            </FadeUp>
          )}

          {/* live progress */}
          {snap.state === "generating" && <BuildingState phase="generating" />}
          {live && <BuildingState progress={snap.progress} />}

          {/* error */}
          {snap.state === "error" && (
            <div className="flex max-w-xl items-start gap-2.5 rounded-2xl border border-reject/30 bg-reject/[0.07] p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-reject" />
              <div>
                <p className="text-sm font-medium text-text">This run failed</p>
                <p className="mt-1 font-mono text-xs leading-relaxed text-muted">{snap.error}</p>
              </div>
            </div>
          )}

          {/* the report */}
          {report && (
            <FadeUp delay={0.08}>
              {windowCount > 1 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                    Window
                  </span>
                  <div className="flex gap-1 rounded-full border border-line bg-bg-soft/50 p-0.5">
                    {Array.from({ length: windowCount }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setWindowIdx(i)}
                        className={`focusable rounded-full px-2.5 py-1 font-mono text-xs transition-colors ${
                          i === selected ? "bg-accent/15 text-text" : "text-muted hover:text-text"
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <span className="font-mono text-[10px] text-faint">
                    equity &amp; sweep show this window
                  </span>
                </div>
              )}
              <VerdictReport scn={report} />

              <CodePanel source={snap.source} />

              <div className="mt-4 flex flex-wrap gap-2">
                {snap.prompt && (
                  <button
                    onClick={rerun}
                    className="focusable inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface/50 px-3.5 py-1.5 text-xs text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Re-run
                  </button>
                )}
                {snap.source && (
                  <button
                    onClick={openInLab}
                    className="focusable inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface/50 px-3.5 py-1.5 text-xs text-text-dim transition-colors hover:bg-white/[0.06] hover:text-text"
                  >
                    <FlaskConical className="h-3.5 w-3.5" /> Open in Lab
                  </button>
                )}
              </div>
            </FadeUp>
          )}
        </>
      )}
    </PageFrame>
  );
}

function CodePanel({ source }: { source: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!source) return null;

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className="panel mt-4 overflow-hidden rounded-2xl">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focusable flex w-full items-center gap-2 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <Code2 className="h-4 w-4 text-accent" />
        <span className="text-sm text-text">Generated strategy</span>
        {open && (
          <span
            onClick={copy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:text-text"
          >
            {copied ? <Check className="h-3 w-3 text-pass" /> : <Copy className="h-3 w-3" />}
            {copied ? "copied" : "copy"}
          </span>
        )}
        <ChevronDown
          className={`${open ? "rotate-180" : ""} ${open ? "" : "ml-auto"} h-4 w-4 text-faint transition-transform`}
        />
      </button>
      {open && (
        <pre className="scroll-thin max-h-96 overflow-auto border-t border-line bg-bg-soft/40 p-5 font-mono text-xs leading-relaxed text-text-dim">
          <code>{source}</code>
        </pre>
      )}
    </div>
  );
}
