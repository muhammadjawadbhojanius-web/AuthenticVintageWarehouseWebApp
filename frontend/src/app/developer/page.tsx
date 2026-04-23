"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Wifi,
  UserCog,
  ShieldCheck,
  Users,
  Terminal,
  PackageSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useSettings } from "@/contexts/settings-context";
import { useAuth, IMPERSONATABLE_ROLES } from "@/contexts/auth-context";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

// The developer hub gives privileged testers a single place to:
//   1. Impersonate any role (the effective role persists across pages)
//   2. Change the backend server address (moved out of /settings so regular
//      users never touch it)
//   3. Jump to admin tools without using the admin shield in the header
//
// Gated by actualRole === "Developer". Regular Admins don't see this page.
export default function DeveloperPage() {
  const router = useRouter();
  const { ready } = useAuthGuard();
  const {
    actualRole,
    isDeveloper,
    roleOverride,
    setRoleOverride,
  } = useAuth();
  const { baseAddress, setBaseAddress } = useSettings();

  const [draft, setDraft] = useState(baseAddress);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(baseAddress);
  }, [baseAddress]);

  // Only Developers should ever land here. Anyone else → back to bundles.
  useEffect(() => {
    if (ready && !isDeveloper) {
      router.replace("/bundles");
    }
  }, [ready, isDeveloper, router]);

  if (!ready || !isDeveloper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const handleSaveServer = () => {
    const value = draft.trim();
    if (!value) return;
    setBaseAddress(value);
    setSavedMessage(`Active server: ${value}`);
    setTimeout(() => setSavedMessage(null), 3000);
  };

  // Effective role for the pill set — what the UI is currently acting as.
  const activeImpersonation: Role = roleOverride ?? actualRole ?? "Developer";

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Terminal className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Developer</h1>
        </div>

        {/* Role impersonation */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <UserCog className="h-4 w-4" /> Test as role
              </h2>
              <p className="text-sm text-muted-foreground">
                Change the role the UI pretends you have. Your real role on
                the server stays <span className="font-mono">Developer</span>;
                only the frontend gating reacts to this.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {IMPERSONATABLE_ROLES.map((r) => {
                const active = activeImpersonation === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() =>
                      setRoleOverride(r === "Developer" ? null : r)
                    }
                    className={cn(
                      "rounded-md border px-3 py-3 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input hover:bg-accent",
                    )}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
            {roleOverride && (
              <Alert variant="warning">
                <AlertDescription>
                  Acting as <strong>{roleOverride}</strong>. Some admin /
                  developer UI is hidden until you switch back.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Backend server */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <Wifi className="h-4 w-4" /> Backend server
              </h2>
              <p className="text-sm text-muted-foreground">
                Address of the FastAPI backend. Use{" "}
                <code className="rounded bg-muted px-1 py-0.5">/api</code>{" "}
                when accessing through the bundled web app, or an IP like{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  192.168.1.100
                </code>{" "}
                for direct LAN access.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="server">Server address</Label>
              <Input
                id="server"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="/api or 192.168.1.100"
                className="font-mono"
              />
            </div>
            <Button onClick={handleSaveServer}>Save</Button>
            {savedMessage && (
              <Alert variant="success">
                <AlertDescription>{savedMessage}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Dev-only features.
            Convention: every feature gated on `isDeveloper` gets a tile
            here, with a DEV pill so it reads as "not yet shipped to
            everyone". That makes this page the single canonical index
            of what's live behind the developer flag — add a tile
            whenever a new flag is introduced. */}
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Developer-only features</h2>
              <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
                Dev
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Features currently gated behind <span className="font-mono">isDeveloper</span>.
              Not yet visible to other roles.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <DevShortcut
                icon={<PackageSearch className="h-5 w-5 text-primary" />}
                title="Stock Report"
                subtitle="Brand / article piece counts across non-sold bundles"
                onClick={() => router.push("/admin/stock")}
              />
            </div>
          </CardContent>
        </Card>

        {/* Admin shortcuts — not dev-only, just handy from here. */}
        <Card>
          <CardContent className="space-y-2 pt-6">
            <h2 className="font-semibold">Admin tools</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => router.push("/admin")}
                className="flex items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-accent"
              >
                <ShieldCheck className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Admin Hub</p>
                  <p className="text-xs text-muted-foreground">
                    User approvals, roles
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => router.push("/admin/users")}
                className="flex items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-accent"
              >
                <Users className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">User management</p>
                  <p className="text-xs text-muted-foreground">
                    Promote other developers
                  </p>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Shortcut tile for a developer-only feature. Matches the Admin Tools
 * tiles but adds a small DEV pill so the distinction is obvious at a
 * glance.
 */
function DevShortcut({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-accent"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{title}</p>
          <span className="rounded-sm bg-warning/15 px-1 text-[9px] font-bold uppercase tracking-wide text-warning">
            Dev
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </button>
  );
}
