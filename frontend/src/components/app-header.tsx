"use client";

import * as React from "react";
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
  const { username, role, logout } = useAuth();
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
        {showLogout && username && (
          <UserMenu
            username={username}
            role={role}
            onLogout={() => {
              logout();
              router.replace("/login");
            }}
          />
        )}
      </div>
    </header>
  );
}

function UserMenu({
  username,
  role,
  onLogout,
}: {
  username: string;
  role: string | null;
  onLogout: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const initial = (username.trim()[0] || "?").toUpperCase();

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`User menu for ${username}`}
        className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-amber-600 text-sm font-semibold text-white ring-2 ring-background transition-transform hover:scale-105 focus:outline-none focus:ring-amber-400"
      >
        {initial}
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-64 overflow-hidden rounded-lg border bg-background shadow-xl"
        >
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-600 text-base font-semibold text-white">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{username}</p>
              {role && (
                <p className="truncate text-xs text-muted-foreground">{role}</p>
              )}
            </div>
          </div>
          <div className="p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent focus:outline-none focus:bg-accent"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
