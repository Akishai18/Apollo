"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Settings, Sparkles, Search, MoreHorizontal } from "lucide-react";
import { Wordmark } from "@/components/logo";
import { APP_STRATEGIES, type StrategyThread } from "@/lib/mock";

const GROUPS: StrategyThread["group"][] = ["Today", "Yesterday", "Earlier"];

function StateDot({ state }: { state: StrategyThread["state"] }) {
  const tone =
    state === "passed" ? "bg-pass" : state === "rejected" ? "bg-reject" : "bg-accent animate-pulse";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />;
}

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = APP_STRATEGIES.filter((s) => s.name.toLowerCase().includes(q));

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-line bg-bg-soft/80 backdrop-blur-xl md:bg-bg-soft/50 md:backdrop-blur-none">
      <div className="flex h-16 items-center px-4">
        <Link href="/app" className="focusable rounded-sm" aria-label="Apollo workspace">
          <Wordmark />
        </Link>
      </div>

      <div className="px-3">
        <Link
          href="/app"
          onClick={onNavigate}
          className="accent-gradient focusable flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium text-accent-ink shadow-lg shadow-accent/25 transition-[filter] hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> New strategy
        </Link>
      </div>

      {/* search */}
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-bg/60 px-2.5 transition-colors focus-within:border-accent/50">
          <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search strategies"
            className="h-8 w-full bg-transparent text-sm text-text placeholder:text-faint focus:outline-none"
          />
          <kbd className="hidden rounded border border-line-strong bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-faint md:inline">
            ⌘K
          </kbd>
        </div>
      </div>

      <nav className="scroll-thin mt-4 flex-1 overflow-y-auto px-3 pb-2" aria-label="Strategies">
        {matches.length === 0 ? (
          <p className="px-2 py-6 text-center font-mono text-xs text-faint">No matches.</p>
        ) : (
          GROUPS.map((group) => {
            const items = matches.filter((s) => s.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="mb-3">
                <div className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                  {group}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {items.map((s, i) => (
                    <li key={s.id}>
                      <Link
                        href="/app"
                        onClick={onNavigate}
                        className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                          group === "Today" && i === 0
                            ? "bg-white/[0.06] text-text"
                            : "text-muted hover:bg-white/[0.04] hover:text-text"
                        }`}
                      >
                        <StateDot state={s.state} />
                        <span className="flex-1 truncate">{s.name}</span>
                        <button
                          aria-label="More"
                          className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                          onClick={(e) => e.preventDefault()}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </nav>

      {/* Companion slot — onboarding agent lands here later */}
      <div className="px-3 pb-3">
        <div className="panel rounded-xl p-3">
          <div className="flex items-center gap-2 text-sm text-text">
            <Sparkles className="h-4 w-4 text-accent" /> Companion
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Your guide. Soon it&rsquo;ll walk you through your first strategy.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 border-t border-line p-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-elevated font-mono text-xs text-text-dim">
          A
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm text-text">Akishai</div>
          <div className="font-mono text-[10px] text-faint">Free plan</div>
        </div>
        <button
          className="focusable rounded-md p-1.5 text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
