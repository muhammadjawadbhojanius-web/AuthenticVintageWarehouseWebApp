"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAuthGuard } from "@/hooks/use-auth-guard";

export default function AdminHubPage() {
  const { ready } = useAuthGuard({ requireRole: "Admin" });
  const router = useRouter();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-2xl">
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
              <p className="text-sm text-muted-foreground">Approve, reject, or change user roles</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
