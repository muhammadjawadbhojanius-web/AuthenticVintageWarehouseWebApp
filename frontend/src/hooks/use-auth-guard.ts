"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";

interface AuthGuardOptions {
  requireRole?: string;
}

/**
 * Client-side route guard. Returns `ready` once the check is done.
 * Redirects to /login if not logged in, or to /bundles if requireRole mismatches.
 */
export function useAuthGuard(opts: AuthGuardOptions = {}): { ready: boolean } {
  const { isLoggedIn, role } = useAuth();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Allow one tick for auth context hydration
    const t = setTimeout(() => {
      if (!isLoggedIn) {
        router.replace("/login");
        return;
      }
      if (opts.requireRole && role !== opts.requireRole) {
        router.replace("/bundles");
        return;
      }
      setReady(true);
    }, 30);
    return () => clearTimeout(t);
  }, [isLoggedIn, role, router, opts.requireRole]);

  return { ready };
}
