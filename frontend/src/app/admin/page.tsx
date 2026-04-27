"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Users, PackageSearch, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useAuth } from "@/contexts/auth-context";

export default function AdminHubPage() {
  const { ready } = useAuthGuard({ requireRole: "Admin" });
  const router = useRouter();
  const { isDeveloper } = useAuth();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Admin Hub</h1>
        </div>

        <Card
          className="cursor-pointer hover:bg-accent/40"
          onClick={() => router.push("/admin/users")}
        >
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold">User Management</p>
              <p className="text-sm text-muted-foreground">
                Approve, reject, or change user roles
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:bg-accent/40"
          onClick={() => router.push("/admin/catalog")}
        >
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Tags className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold">Catalog Management</p>
              <p className="text-sm text-muted-foreground">
                Add, approve, or remove brands and articles
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Developer-only for now. The /admin/stock page also re-checks
            isDeveloper so nobody reaches it by URL. */}
        {isDeveloper && (
          <Card
            className="cursor-pointer hover:bg-accent/40"
            onClick={() => router.push("/admin/stock")}
          >
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <PackageSearch className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">
                  Stock Report
                  <span className="ml-2 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
                    Dev
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Brand / article / combined piece counts across every
                  non-sold bundle
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
