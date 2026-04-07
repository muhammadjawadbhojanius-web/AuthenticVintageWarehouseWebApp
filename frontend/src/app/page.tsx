"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Spinner } from "@/components/ui/spinner";

export default function HomePage() {
  const router = useRouter();
  const { isLoggedIn } = useAuth();

  useEffect(() => {
    // Wait one tick so the auth context can hydrate from localStorage.
    const t = setTimeout(() => {
      router.replace(isLoggedIn ? "/bundles" : "/login");
    }, 50);
    return () => clearTimeout(t);
  }, [isLoggedIn, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}
