"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/*
  Shared chrome for every gated-app page. Puts content on the same atmospheric
  surface as the workspace — a faint dot-grid, a single slow accent glow, and a
  film-grain overlay — then a centered, max-width column. Keeps the dashboard,
  lab, visualizer, settings, and strategies pages visually of-a-piece.
*/
export function PageFrame({
  children,
  max = "max-w-5xl",
}: {
  children: ReactNode;
  max?: string;
}) {
  // Ambient background (aurora + dot-grid + grain) is provided once by AppShell;
  // pages just scroll their content on top of it.
  return (
    <div className="scroll-thin relative flex-1 overflow-y-auto">
      <div className={`mx-auto ${max} px-6 py-10`}>{children}</div>
    </div>
  );
}

/* Page-load fade + rise. Mount-based (not scroll), staggered via `delay`. */
export function FadeUp({
  children,
  delay = 0,
  y = 16,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/*
  Consistent page header: a small mono eyebrow, a display title (optionally with
  a leading icon), a muted subtitle, and an optional right-aligned action slot.
*/
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  icon,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <FadeUp className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent/80">
          {eyebrow}
        </div>
        <h1 className="flex items-center gap-2.5 font-display text-[1.7rem] font-semibold leading-none tracking-tight text-text">
          {icon}
          {title}
        </h1>
        {subtitle && <p className="mt-2.5 max-w-xl leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {action}
    </FadeUp>
  );
}
