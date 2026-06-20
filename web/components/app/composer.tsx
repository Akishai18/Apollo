"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Sparkles } from "lucide-react";
import { COMPOSER_EXAMPLES } from "@/lib/mock";
import { APOLLO_TIERS, DEFAULT_TIER, type TierKey } from "@/lib/api";

/*
  The workspace composer — prompt-first. Enter builds, Shift+Enter newlines.
  Used both as the centered empty-state input and the docked thread input. The
  tier selector picks Apollo's (branded) model; the real model is server-side.
*/
export function Composer({
  onSubmit,
  showExamples = false,
  placeholder = "Describe a trading strategy in plain English…",
  autoFocus = false,
}: {
  onSubmit: (prompt: string, tier: TierKey) => void;
  showExamples?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [tier, setTier] = useState<TierKey>(DEFAULT_TIER);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canBuild = value.trim().length > 0;

  function submit() {
    const v = value.trim();
    if (!v) return;
    onSubmit(v, tier);
    setValue("");
    taRef.current?.focus();
  }

  return (
    <div>
      <div className="glass rounded-2xl p-3 transition-colors focus-within:border-accent/60">
        <textarea
          ref={taRef}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={placeholder}
          className="field-sizing-content max-h-48 w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-text placeholder:text-faint focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <TierSelect tier={tier} onChange={setTier} />
            <span className="hidden items-center gap-1.5 rounded-full border border-line-strong bg-elevated px-2.5 py-1 font-mono text-[11px] text-text-dim sm:inline-flex">
              Validate
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="hidden font-mono text-[10px] text-faint sm:inline">
              ↵ build · ⇧↵ new line
            </span>
            <button
              onClick={submit}
              disabled={!canBuild}
              className="focusable inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 font-mono text-xs font-medium text-accent-ink transition-[background-color,opacity] hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-40"
            >
              Build <ArrowUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {showExamples && (
        <div className="mt-4 flex flex-wrap gap-2">
          {COMPOSER_EXAMPLES.map((ex, i) => (
            <button
              key={i}
              onClick={() => onSubmit(ex, tier)}
              className="focusable rounded-full border border-line bg-surface/50 px-3 py-1.5 text-left font-mono text-xs text-muted transition-colors hover:border-accent/40 hover:text-text"
            >
              {ex.length > 52 ? `${ex.slice(0, 52)}…` : ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Branded model picker. Reveals only Apollo names — never the model behind them. */
function TierSelect({ tier, onChange }: { tier: TierKey; onChange: (t: TierKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = APOLLO_TIERS.find((t) => t.key === tier) ?? APOLLO_TIERS[2];

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="focusable inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-elevated px-2.5 py-1 font-mono text-[11px] text-text-dim transition-colors hover:text-text"
      >
        <Sparkles className="h-3 w-3 text-accent" /> {current.name}
        <ChevronDown className="h-3 w-3 text-faint" />
      </button>

      {open && (
        <div
          role="listbox"
          className="panel absolute bottom-full left-0 z-20 mb-2 w-60 overflow-hidden rounded-xl p-1"
        >
          {APOLLO_TIERS.map((t) => (
            <button
              key={t.key}
              role="option"
              aria-selected={t.key === tier}
              onClick={() => {
                onChange(t.key);
                setOpen(false);
              }}
              className="focusable flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]"
            >
              <Check
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                  t.key === tier ? "text-accent" : "text-transparent"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-text">{t.name}</span>
                <span className="block text-[11px] leading-snug text-muted">{t.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
