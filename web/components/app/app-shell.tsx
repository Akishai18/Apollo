"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Wordmark } from "@/components/logo";
import { AppSidebar } from "./app-sidebar";

/*
  Responsive app chrome. Desktop: static sidebar. Mobile (< md): the sidebar is
  an off-canvas drawer with a backdrop, opened from a slim top bar.
*/
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* desktop sidebar */}
      <div className="hidden md:flex">
        <AppSidebar />
      </div>

      {/* mobile drawer + backdrop */}
      <div
        className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <AppSidebar onNavigate={() => setOpen(false)} />
      </div>

      {/* content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 md:hidden">
          <button
            onClick={() => setOpen(true)}
            className="focusable -ml-1 rounded-lg p-2 text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Wordmark />
        </div>

        {children}
      </div>
    </div>
  );
}
