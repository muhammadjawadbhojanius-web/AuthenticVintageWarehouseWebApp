"use client";

// TEMPORARY — test banner to verify the auto-update flow (setup.bat +
// git pull). Delete this file and remove its import from providers.tsx
// once the update workflow is confirmed working.

export function TestBanner() {
  return (
    <div className="pointer-events-none fixed left-1/2 top-16 z-[200] -translate-x-1/2">
      <div className="pointer-events-auto rounded-full border-2 border-amber-500 bg-amber-100 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-900 shadow-lg dark:bg-amber-950 dark:text-amber-200">
        🧪 Auto-update test — build 2026-04-15
      </div>
    </div>
  );
}
