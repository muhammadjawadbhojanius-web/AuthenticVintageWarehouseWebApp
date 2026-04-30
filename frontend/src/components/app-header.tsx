"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useConnectivity } from "@/hooks/use-connectivity";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  showLogout?: boolean;
}

export function AppHeader({ showLogout = true }: AppHeaderProps) {
  const router = useRouter();
  const { username, role, isDeveloper, roleOverride, logout } = useAuth();
  const connected = useConnectivity();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border/50 bg-background/90 px-4 py-3 backdrop-blur-md backdrop-saturate-150">
      {/* ── Brand mark ─────────────────────────────────────────────────────── */}
      <Link href="/bundles" className="group flex items-baseline gap-2.5 select-none">
        <span className="font-display text-2xl font-medium italic leading-none text-primary transition-opacity group-hover:opacity-80">
          Authentic
        </span>
        <span className="text-[11px] font-bold tracking-[0.25em] text-foreground/70 uppercase transition-opacity group-hover:opacity-60">
          Vintage
        </span>
      </Link>

      {/* ── Right toolbar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5">
        {/* Server connectivity indicator */}
        <span
          title={connected ? "Server connected" : "Server not connected"}
          aria-label={connected ? "Server connected" : "Server not connected"}
          className={cn(
            "mr-2 inline-block h-2 w-2 rounded-full ring-[1.5px] ring-background",
            connected
              ? "bg-success"
              : "bg-destructive animate-pulse",
          )}
        />

        {isDeveloper && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Developer"
            onClick={() => router.push("/developer")}
            title={roleOverride ? `Developer (acting as ${roleOverride})` : "Developer"}
            className="text-muted-foreground hover:text-foreground"
          >
            <Terminal
              className={cn(
                "h-[18px] w-[18px]",
                roleOverride && "text-warning",
              )}
            />
          </Button>
        )}

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
  const menuRef   = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const initial = (username.trim()[0] || "?").toUpperCase();

  return (
    <div className="relative ml-1">
      {/* Avatar button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`User menu for ${username}`}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full",
          "bg-primary text-primary-foreground",
          "text-xs font-bold tracking-wide",
          "ring-2 ring-background transition-all duration-150",
          "hover:ring-primary/40 hover:scale-105",
          "focus:outline-none focus:ring-primary/40",
        )}
      >
        {initial}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={menuRef}
          className={cn(
            "absolute right-0 top-[calc(100%+0.5rem)] z-40 w-60 overflow-hidden",
            "rounded-lg border border-border/60 bg-popover shadow-xl shadow-black/20",
          )}
        >
          {/* User identity strip */}
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{username}</p>
              {role && (
                <p className="truncate text-[10px] font-bold tracking-wider uppercase text-muted-foreground mt-0.5">
                  {role}
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="p-1">
            <button
              type="button"
              onClick={() => { setOpen(false); onLogout(); }}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:bg-accent"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
