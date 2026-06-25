import { AppSidebar } from "./app-sidebar";

/*
  App chrome: a collapsible icon rail on the left, then the page content. Behind
  the content sits a toned-down version of the hero atmosphere — a slow drifting
  aurora plus a faint dot-grid and grain — kept subtle so it reads as depth, not
  decoration. Pages own their own headers and scrolling on top of it.
*/
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <AppSidebar />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* ambient background — like the hero, dialed way down */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
          <div className="aurora absolute inset-0 opacity-[0.28]">
            <span />
          </div>
          <div className="dot-grid fade-down absolute inset-0 opacity-30" />
          <div className="grain absolute inset-0" />
          <div className="vignette absolute inset-0" />
        </div>
        {children}
      </div>
    </div>
  );
}
