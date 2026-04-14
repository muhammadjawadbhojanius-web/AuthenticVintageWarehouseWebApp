"use client";

import * as React from "react";
import { CheckCircle2, Loader2, X, AlertCircle, CloudUpload } from "lucide-react";
import { useUploadQueue, type UploadTask } from "@/contexts/upload-queue-context";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Collapsible floating queue indicator. Renders a small cloud-upload
 * button to the left of the bundle list FAB; clicking it toggles a card
 * listing all tasks in flight. Hidden entirely when the queue is empty.
 */
export function UploadQueueIndicator() {
  const { tasks, dismiss } = useUploadQueue();
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  // Close when clicking outside.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  if (tasks.length === 0) return null;

  const active = tasks.filter((t) => t.status === "queued" || t.status === "running").length;
  const failed = tasks.filter((t) => t.status === "failed").length;

  const dotColor = failed > 0 ? "bg-red-500" : active > 0 ? "bg-amber-500" : "bg-emerald-500";
  const badge = tasks.length;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Upload queue (${tasks.length})`}
        className="fixed bottom-12 left-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-background text-foreground shadow-lg ring-1 ring-border transition-transform hover:scale-105"
      >
        <CloudUpload className="h-5 w-5" />
        <span className={cn("absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white", dotColor)}>
          {badge}
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="fixed bottom-[72px] left-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border bg-background shadow-xl"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Uploads</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} onDismiss={() => dismiss(t.id)} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function TaskRow({ task, onDismiss }: { task: UploadTask; onDismiss: () => void }) {
  const icon =
    task.status === "done" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : task.status === "failed" ? (
      <AlertCircle className="h-4 w-4 text-red-600" />
    ) : (
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
    );

  const fileLabel = task.fileCount === 1 ? "1 file" : `${task.fileCount} files`;

  return (
    <div className="border-b px-3 py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium">Bundle {task.bundleCode}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{fileLabel}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={task.label}>
            {task.status === "failed" ? task.error || "Upload failed" : task.label}
          </p>
          {task.status !== "done" && task.status !== "failed" && (
            <div className="mt-2 flex items-center gap-2">
              <Progress value={task.progress * 100} className="flex-1" />
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {Math.round(task.progress * 100)}%
              </span>
            </div>
          )}
        </div>
        {(task.status === "done" || task.status === "failed") && (
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onDismiss} aria-label="Dismiss">
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
