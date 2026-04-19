import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shaped skeletons used as layout-matched placeholders while data loads.
 * Each one deliberately matches the real component's box metrics so the
 * swap to real content doesn't cause a jump.
 */

/** Mirrors BundleCard — thumbnail + identity + metadata + action footer. */
export function BundleCardSkeleton() {
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-stretch gap-3 p-3">
        {/* Thumbnail — same 96×96 box as the real card */}
        <Skeleton className="h-24 w-24 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top row: code + media badge */}
          <div className="flex items-start gap-2">
            <Skeleton className="h-5 w-28 flex-1 max-w-[10rem]" />
            <Skeleton className="h-4 w-16 shrink-0 rounded-md" />
          </div>
          {/* Name line */}
          <Skeleton className="mt-2 h-3.5 w-40 max-w-full" />
          {/* Bottom metadata row: pieces + date */}
          <div className="mt-auto flex items-end justify-between gap-2 pt-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      </div>
      {/* Action footer — 3 equal columns */}
      <div className="grid grid-cols-3 divide-x border-t">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center justify-center gap-1 py-3">
            <Skeleton className="h-5 w-5 rounded-sm" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** A full list of N skeleton cards inside the same wrapper the list uses. */
export function BundleListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="mx-auto max-w-2xl space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <BundleCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Body content of the bundle detail page — media card + items card. The
 * page renders its own header (back button / code / actions), so the
 * skeleton only covers what would otherwise be a blank area below.
 */
export function BundleDetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      {/* Media card */}
      <Card className="p-6">
        <Skeleton className="h-4 w-24" />
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-md" />
          ))}
        </div>
      </Card>

      {/* Items card */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-md border p-3"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
