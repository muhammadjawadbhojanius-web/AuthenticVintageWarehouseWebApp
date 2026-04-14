"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useConnectivity } from "@/hooks/use-connectivity";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  showAdmin?: boolean;
  showLogout?: boolean;
}

export function AppHeader({ showAdmin = false, showLogout = true }: AppHeaderProps) {
  const router = useRouter();
  const { role, logout } = useAuth();
  const isAdmin = role === "Admin";
  const connected = useConnectivity();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur">
      <Link href="/bundles" className="flex items-baseline gap-2">
        <span
          className="text-xl font-bold text-amber-700 dark:text-amber-500"
          style={{ fontFamily: "Inter, serif" }}
        >
          Authentic
        </span>
        <span className="text-base font-black tracking-wider text-foreground">VINTAGE</span>
      </Link>
      <div className="flex items-center gap-1">
        <span
          title={connected ? "Server connected" : "Server not connected"}
          aria-label={connected ? "Server connected" : "Server not connected"}
          className={cn(
            "mr-1 inline-block h-2.5 w-2.5 rounded-full ring-2 ring-background",
            connected ? "bg-emerald-500" : "bg-red-500 animate-pulse",
          )}
        />
        {showAdmin && isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Admin"
            onClick={() => router.push("/admin")}
          >
            <ShieldCheck className="h-5 w-5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Settings"
          onClick={() => router.push("/settings")}
        >
          <SettingsIcon className="h-5 w-5" />
        </Button>
        {showLogout && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Logout"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
          >
            <LogOut className="h-5 w-5" />
          </Button>
        )}
      </div>
    </header>
  );
}
