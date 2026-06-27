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
  ScanLine,
  ShieldCheck,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { ApolloMark } from "@/components/logo";
import { useAuth } from "@/lib/auth-context";

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
  { href: "/app/visualizer", label: "Visualizer", icon: ScanLine, match: (p: string) => p.startsWith("/app/visualizer") },
  { href: "/app/validation", label: "Validation", icon: ShieldCheck, match: (p: string) => p.startsWith("/app/validation") },
  { href: "/app/experiments", label: "Experiments", icon: FlaskConical, match: (p: string) => p.startsWith("/app/experiments") },
] as const;

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/app";
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const onSettings = pathname.startsWith("/app/settings");
  const displayName =
    user?.user_metadata.full_name?.toString() || user?.email?.split("@")[0] || "Apollo";
  const initial = displayName.slice(0, 1).toUpperCase();

  return (
    <aside
      className={`flex h-screen shrink-0 flex-col border-r border-line bg-bg py-3 transition-[width] duration-200 ease-out ${
        expanded ? "w-52 px-2" : "w-12 items-center px-0"
      }`}
    >
      {/* brand */}
      <Link
        href="/"
        className={`focusable mb-3 flex h-8 items-center rounded ${expanded ? "gap-2 px-1" : "justify-center"}`}
        aria-label="Apollo home"
      >
        <ApolloMark className="h-6 w-6 shrink-0" />
        {expanded && (
          <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em] text-text">
            Apollo
          </span>
        )}
      </Link>

      {/* new strategy */}
      <Link
        href="/app"
        onClick={onNavigate}
        aria-label="New strategy"
        className={`group accent-gradient focusable relative flex items-center rounded text-accent-ink transition-[filter] hover:brightness-110 ${
          expanded ? "h-8 gap-2 px-2" : "mx-auto h-8 w-8 justify-center"
        }`}
      >
        <Plus className="h-4 w-4 shrink-0" />
        {expanded && <span className="font-mono text-[11px] uppercase tracking-wider">New strategy</span>}
        {!expanded && <Tooltip label="New strategy" />}
      </Link>

      <div className={`my-3 h-px bg-line ${expanded ? "w-full" : "w-8"}`} />

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
        className={`group relative mt-auto flex items-center rounded text-muted transition-colors hover:bg-white/[0.05] hover:text-text ${
          expanded ? "h-8 gap-2 px-2" : "mx-auto h-8 w-8 justify-center"
        }`}
      >
        {expanded ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        {expanded && <span className="font-mono text-[11px] uppercase tracking-wider">Collapse</span>}
        {!expanded && <Tooltip label="Expand" />}
      </button>

      {/* account */}
      <Link
        href="/app/settings"
        onClick={onNavigate}
        aria-label="Account & settings"
        className={`group relative mt-1 flex items-center rounded transition-colors ${
          expanded ? "gap-2 px-1 py-1 hover:bg-white/[0.04]" : "mx-auto justify-center"
        } ${!expanded ? "h-8 w-8" : ""}`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded font-mono text-xs accent-gradient text-accent-ink ${
            onSettings ? "ring-2 ring-accent/40" : ""
          }`}
        >
          {initial}
        </span>
        {expanded ? (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-xs text-text">{displayName}</span>
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
      className={`group relative flex items-center rounded transition-colors ${
        expanded ? "h-8 gap-2 px-2" : "h-8 w-8 justify-center"
      } ${
        active
          ? "bg-accent/12 text-accent ring-1 ring-inset ring-accent/35"
          : "text-muted hover:bg-white/[0.05] hover:text-text"
      }`}
    >
      {children}
      {expanded && <span className="font-mono text-[11px] uppercase tracking-wider">{label}</span>}
      {!expanded && <Tooltip label={label} />}
    </Link>
  );
}

function Tooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded border border-line-strong bg-elevated px-2 py-1 font-mono text-[10px] text-text-dim opacity-0 transition-opacity duration-150 group-hover:opacity-100 md:block">
      {label}
    </span>
  );
}
