"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Users, PackageSearch, Tags, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface NavCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  badge?: React.ReactNode;
}

function NavCard({ icon: Icon, title, description, onClick, badge }: NavCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full text-left",
        "flex items-center gap-4 rounded-lg border border-border/60 bg-card p-4",
        "transition-all duration-200",
        "hover:border-primary/30 hover:bg-accent/30 hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
    >
      {/* Icon container — amber ring on hover */}
      <div className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
        "bg-primary/10 ring-1 ring-primary/20",
        "transition-all duration-200 group-hover:bg-primary/15 group-hover:ring-primary/35",
      )}>
        <Icon className="h-5 w-5 text-primary" />
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-semibold text-foreground">
          {title}
          {badge}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>

      {/* Chevron hint */}
      <svg
        className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary/50"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

export default function AdminHubPage() {
  const { ready } = useAuthGuard({ requireRole: "Admin" });
  const router    = useRouter();
  const { isDeveloper } = useAuth();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border/50 bg-background/90 px-4 py-3 backdrop-blur-md">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-sm font-semibold">Admin Hub</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-2.5 p-4">
        <NavCard
          icon={Users}
          title="User Management"
          description="Approve, reject, or change user roles"
          onClick={() => router.push("/admin/users")}
        />
        <NavCard
          icon={Tags}
          title="Catalog Management"
          description="Add, approve, or remove brands and articles"
          onClick={() => router.push("/admin/catalog")}
        />
        <NavCard
          icon={MapPin}
          title="Bundle Locations"
          description="Assign warehouse rack locations to bundles"
          onClick={() => router.push("/admin/bundle-locations")}
        />
        {isDeveloper && (
          <NavCard
            icon={PackageSearch}
            title="Stock Report"
            description="Brand / article / combined piece counts across every non-sold bundle"
            onClick={() => router.push("/admin/stock")}
            badge={
              <span className="inline-block rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase text-warning">
                Dev
              </span>
            }
          />
        )}
      </div>
    </div>
  );
}
