import { AppShell } from "@/components/app/app-shell";
import { AuthGate } from "@/components/app/auth-gate";
import { RunsProvider } from "@/lib/runs-context";

// The gated app shell: responsive sidebar (static on desktop, drawer on mobile)
// + the workspace surface. Its own chrome — no marketing header/footer. Run
// history is shared across the shell + pages via RunsProvider.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <RunsProvider>
        <div className="app-terminal">
          <AppShell>{children}</AppShell>
        </div>
      </RunsProvider>
    </AuthGate>
  );
}
