import { AppShell } from "@/components/app/app-shell";

// The gated app shell: responsive sidebar (static on desktop, drawer on mobile)
// + the workspace surface. Its own chrome — no marketing header/footer.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
