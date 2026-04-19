import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Pulsing placeholder block. Compose several of these into shapes that
 * mirror the real component's layout so the swap to real content doesn't
 * cause a visual jump.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
