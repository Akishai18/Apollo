"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { configured, loading, session } = useAuth();

  useEffect(() => {
    if (!configured || loading || session) return;
    const next = pathname && pathname !== "/app" ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${next}`);
  }, [configured, loading, pathname, router, session]);

  if (!configured) return <>{children}</>;
  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg font-mono text-xs text-faint">
        Checking session…
      </div>
    );
  }
  return <>{children}</>;
}
