import { AppSidebar } from "./app-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <AppSidebar />
      <div className="relative flex min-w-0 flex-1 flex-col bg-bg">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-30" aria-hidden="true">
          <div className="grid-lines absolute inset-0" />
        </div>
        {children}
      </div>
    </div>
  );
}
