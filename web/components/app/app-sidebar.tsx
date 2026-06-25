"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Plus,
  PanelsTopLeft,
  LayoutGrid,
  Clock,
  FlaskConical,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { ApolloMark } from "@/components/logo";

/*
  The primary nav rail. Collapsed it's a 64px icon strip with hover tooltips;
  expanded it widens to show labels, the Apollo wordmark, and the account row.
  Lives in the persistent AppShell, so the toggle state survives route changes.
*/
const NAV = [
  { href: "/app", label: "Workspace", icon: PanelsTopLeft, match: (p: string) => p === "/app" },
  { href: "/app/dashboard", label: "Dashboard", icon: LayoutGrid, match: (p: string) => p.startsWith("/app/dashboard") },
  { href: "/app/strategies", label: "Strategies", icon: Clock, match: (p: string) => p.startsWith("/app/strategies") || p.startsWith("/app/runs") },
  { href: "/app/backtest", label: "Backtester", icon: FlaskConical, match: (p: string) => p.startsWith("/app/backtest") },
] as const;

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/app";
  const [expanded, setExpanded] = useState(false);
  const onSettings = pathname.startsWith("/app/settings");

  return (
    <aside
      className={`flex h-screen shrink-0 flex-col border-r border-line bg-bg-soft/50 py-4 transition-[width] duration-200 ease-out ${
        expanded ? "w-56 px-3" : "w-16 items-center px-0"
      }`}
    >
      {/* brand */}
      <Link
        href="/"
        className={`focusable mb-3 flex h-9 items-center rounded-lg ${expanded ? "gap-2 px-1" : "justify-center"}`}
        aria-label="Apollo home"
      >
        <ApolloMark className="h-7 w-7 shrink-0" />
        {expanded && (
          <span className="font-display text-lg font-semibold tracking-[-0.02em] text-text">
            Apollo
          </span>
        )}
      </Link>

      {/* new strategy */}
      <Link
        href="/app"
        onClick={onNavigate}
        aria-label="New strategy"
        className={`group accent-gradient focusable relative flex items-center rounded-xl text-accent-ink shadow-lg shadow-accent/20 transition-[filter] hover:brightness-110 ${
          expanded ? "h-10 gap-2.5 px-3" : "mx-auto h-10 w-10 justify-center"
        }`}
      >
        <Plus className="h-[18px] w-[18px] shrink-0" />
        {expanded && <span className="text-sm font-medium">New strategy</span>}
        {!expanded && <Tooltip label="New strategy" />}
      </Link>

      <div className={`my-3 h-px bg-line ${expanded ? "w-full" : "w-7"}`} />

      {/* nav */}
      <nav className={`flex flex-col gap-1 ${expanded ? "" : "items-center"}`} aria-label="Primary">
        {NAV.map(({ href, label, icon: Icon, match }) => (
          <RailButton
            key={href}
            href={href}
            label={label}
            active={match(pathname)}
            expanded={expanded}
            onNavigate={onNavigate}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
          </RailButton>
        ))}
      </nav>

      {/* collapse toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        className={`group relative mt-auto flex items-center rounded-xl text-muted transition-colors hover:bg-white/[0.05] hover:text-text ${
          expanded ? "h-9 gap-3 px-3" : "mx-auto h-10 w-10 justify-center"
        }`}
      >
        {expanded ? <ChevronsLeft className="h-[18px] w-[18px]" /> : <ChevronsRight className="h-[18px] w-[18px]" />}
        {expanded && <span className="text-sm">Collapse</span>}
        {!expanded && <Tooltip label="Expand" />}
      </button>

      {/* account */}
      <Link
        href="/app/settings"
        onClick={onNavigate}
        aria-label="Account & settings"
        className={`group relative mt-1 flex items-center rounded-xl transition-colors ${
          expanded ? "gap-2.5 px-2 py-1.5 hover:bg-white/[0.04]" : "mx-auto justify-center"
        } ${!expanded ? "h-10 w-10" : ""}`}
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-xs accent-gradient text-accent-ink ${
            onSettings ? "ring-2 ring-accent/40" : ""
          }`}
        >
          A
        </span>
        {expanded ? (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm text-text">Akishai</span>
            <span className="block font-mono text-[10px] text-faint">Apollo Spark · Free</span>
          </span>
        ) : (
          <Tooltip label="Account" />
        )}
      </Link>
    </aside>
  );
}

function RailButton({
  href,
  label,
  active = false,
  expanded,
  onNavigate,
  children,
}: {
  href: string;
  label: string;
  active?: boolean;
  expanded: boolean;
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-label={label}
      className={`group relative flex items-center rounded-xl transition-colors ${
        expanded ? "h-10 gap-3 px-3" : "h-10 w-10 justify-center"
      } ${
        active
          ? "bg-accent/15 text-accent ring-1 ring-inset ring-accent/30"
          : "text-muted hover:bg-white/[0.05] hover:text-text"
      }`}
    >
      {children}
      {expanded && <span className="text-sm">{label}</span>}
      {!expanded && <Tooltip label={label} />}
    </Link>
  );
}

function Tooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-md border border-line-strong bg-elevated px-2 py-1 font-mono text-[10px] text-text-dim opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 md:block">
      {label}
    </span>
  );
}
