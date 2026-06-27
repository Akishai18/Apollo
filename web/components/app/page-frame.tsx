"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export function PageFrame({
  children,
  max = "max-w-[1500px]",
}: {
  children: ReactNode;
  max?: string;
}) {
  return (
    <div className="scroll-thin relative flex-1 overflow-y-auto">
      <div className={`mx-auto ${max} px-3 py-2.5 sm:px-4`}>{children}</div>
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
    <motion.div className={className} initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, delay, ease: [0.22, 1, 0.36, 1] }}>
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
    <FadeUp className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded border border-accent/20 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            {eyebrow}
          </span>
          <h1 className="flex items-center gap-2 text-[15px] font-semibold leading-tight text-text sm:text-base">
            {icon}
            {title}
          </h1>
        </div>
        {subtitle && <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{subtitle}</p>}
      </div>
      {action}
    </FadeUp>
  );
}
