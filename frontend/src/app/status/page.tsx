"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Hourglass, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

function StatusInner() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "pending";
  const isPending = status === "pending";

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 text-center">
          {isPending ? (
            <Hourglass className="mx-auto h-16 w-16 text-warning" />
          ) : (
            <XCircle className="mx-auto h-16 w-16 text-destructive" />
          )}
          <h1 className="mt-4 text-2xl font-semibold">
            {isPending ? "Approval Pending" : "Account Rejected"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isPending
              ? "Your account has been created but is waiting for an administrator to approve it."
              : "Your account registration was rejected by an administrator. Please contact your manager."}
          </p>
          <Link href="/login" className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Return to Login
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={null}>
      <StatusInner />
    </Suspense>
  );
}
