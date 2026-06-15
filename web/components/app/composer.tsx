"use client";

import { useRef, useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { COMPOSER_EXAMPLES } from "@/lib/mock";

/*
  The workspace composer — prompt-first. Enter builds, Shift+Enter newlines.
  Used both as the centered empty-state input and the docked thread input.
*/
export function Composer({
  onSubmit,
  showExamples = false,
  placeholder = "Describe a trading strategy in plain English…",
  autoFocus = false,
}: {
  onSubmit: (prompt: string) => void;
  showExamples?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canBuild = value.trim().length > 0;

  function submit() {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-elevated px-2.5 py-1 font-mono text-[11px] text-text-dim">
              <Sparkles className="h-3 w-3 text-accent" /> Apollo
            </span>
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
              onClick={() => onSubmit(ex)}
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
