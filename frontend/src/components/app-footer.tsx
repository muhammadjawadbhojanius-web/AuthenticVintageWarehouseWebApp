"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, MapPin, ShieldCheck, Settings } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

export function AppFooter() {
  const { isLoggedIn, role } = useAuth();
  const pathname = usePathname();

  // Don't render on auth / utility screens.
  if (!isLoggedIn) return null;
  if (pathname === "/login" || pathname === "/status" || pathname === "/") return null;

  const isAdmin = role === "Admin";

  const navItems = [
    {
      href: "/bundles",
      label: "Bundles",
      icon: Package,
      match: (p: string) => p.startsWith("/bundles"),
    },
    {
      href: "/admin/bundle-locations",
      label: "Locations",
      icon: MapPin,
      match: (p: string) => p.startsWith("/admin/bundle-locations"),
    },
    ...(isAdmin
      ? [{
          href: "/admin",
          label: "Admin",
          icon: ShieldCheck,
          match: (p: string) => p.startsWith("/admin") && !p.startsWith("/admin/bundle-locations"),
        }]
      : []),
    {
      href: "/settings",
      label: "Settings",
      icon: Settings,
      match: (p: string) => p.startsWith("/settings"),
    },
  ];

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-40 flex h-14 items-stretch border-t bg-background/90 backdrop-blur"
    >
      {navItems.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
              active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className={cn("h-5 w-5", active && "stroke-[2.25]")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
