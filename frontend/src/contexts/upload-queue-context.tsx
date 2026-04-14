"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chunkedUpload } from "@/lib/chunked-upload";
import { compressAndUploadPipelined } from "@/lib/video-compressor";

// ---------------------------------------------------------------------------
// Background upload queue.
//
// Tasks live in a ref (source of truth) so the worker loop can mutate them
// synchronously. `version` is bumped whenever we want React to re-render
// the UI; callers read `tasks` which is a snapshot of the ref.
//
// One task is processed at a time so we don't hammer the weak i3 server.
// Files inside a single task still pipeline (compress N+1 while uploading
// N) via compressAndUploadPipelined.
// ---------------------------------------------------------------------------

export type UploadTaskStatus = "queued" | "running" | "done" | "failed";

export interface UploadTask {
  id: string;
  bundleCode: string;
  fileCount: number;
  status: UploadTaskStatus;
  progress: number;
  label: string;
  error?: string;
  finishedAt?: number;
}

interface InternalTask extends UploadTask {
  files: File[];
  onComplete?: () => Promise<void> | void;
}

interface EnqueueOptions {
  bundleCode: string;
  files: File[];
  onComplete?: () => Promise<void> | void;
}

interface UploadQueueContextValue {
  tasks: UploadTask[];
  enqueue: (opts: EnqueueOptions) => string;
  dismiss: (id: string) => void;
  hasActive: boolean;
}

const UploadQueueContext = React.createContext<UploadQueueContextValue | null>(null);

const AUTO_DISMISS_MS = 6_000;

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const tasksRef = React.useRef<InternalTask[]>([]);
  const [, setVersion] = React.useState(0);
  const processingRef = React.useRef(false);
  const queryClient = useQueryClient();

  // Trigger a UI re-render after any ref mutation.
  const bump = React.useCallback(() => setVersion((v) => v + 1), []);

  const patch = React.useCallback(
    (id: string, changes: Partial<InternalTask>) => {
      const idx = tasksRef.current.findIndex((t) => t.id === id);
      if (idx === -1) return;
      tasksRef.current[idx] = { ...tasksRef.current[idx], ...changes };
      bump();
    },
    [bump],
  );

  const remove = React.useCallback(
    (id: string) => {
      tasksRef.current = tasksRef.current.filter((t) => t.id !== id);
      bump();
    },
    [bump],
  );

  const processNext = React.useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (true) {
        const next = tasksRef.current.find((t) => t.status === "queued");
        if (!next) return;

        patch(next.id, { status: "running", label: "Starting…" });

        try {
          await compressAndUploadPipelined({
            files: next.files,
            uploadFile: (file, onProgress) =>
              chunkedUpload({
                bundleCode: next.bundleCode,
                file,
                onUploadProgress: (p) => onProgress(0.85 * p),
                onProcessProgress: (p) => onProgress(0.85 + 0.15 * p),
              }),
            onProgress: ({ overall, label }) => {
              patch(next.id, { progress: overall, label });
            },
          });

          if (next.onComplete) {
            try {
              await next.onComplete();
            } catch (err) {
              console.warn("[upload-queue] onComplete hook failed:", err);
            }
          }

          queryClient.invalidateQueries({ queryKey: ["bundles"] });
          queryClient.invalidateQueries({ queryKey: ["bundle", next.bundleCode] });

          patch(next.id, {
            status: "done",
            progress: 1,
            label: "Uploaded",
            finishedAt: Date.now(),
          });

          const doneId = next.id;
          setTimeout(() => remove(doneId), AUTO_DISMISS_MS);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[upload-queue] task failed:", err);
          patch(next.id, {
            status: "failed",
            error: msg,
            label: "Failed",
            finishedAt: Date.now(),
          });
          // Leave failed tasks visible until dismissed so the error isn't missed.
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [patch, queryClient, remove]);

  const enqueue = React.useCallback(
    (opts: EnqueueOptions): string => {
      const id = `upl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      tasksRef.current.push({
        id,
        bundleCode: opts.bundleCode,
        fileCount: opts.files.length,
        status: "queued",
        progress: 0,
        label: "Queued",
        files: opts.files,
        onComplete: opts.onComplete,
      });
      bump();
      void processNext();
      return id;
    },
    [bump, processNext],
  );

  const dismiss = React.useCallback((id: string) => remove(id), [remove]);

  const tasks: UploadTask[] = tasksRef.current.map((t) => ({
    id: t.id,
    bundleCode: t.bundleCode,
    fileCount: t.fileCount,
    status: t.status,
    progress: t.progress,
    label: t.label,
    error: t.error,
    finishedAt: t.finishedAt,
  }));

  const hasActive = tasks.some((t) => t.status === "queued" || t.status === "running");

  React.useEffect(() => {
    if (!hasActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Uploads are still in progress. Leave the page?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasActive]);

  const value = React.useMemo<UploadQueueContextValue>(
    () => ({ tasks, enqueue, dismiss, hasActive }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks.length, tasks.map((t) => `${t.id}:${t.status}:${t.progress.toFixed(3)}:${t.label}`).join("|"), enqueue, dismiss, hasActive],
  );

  return (
    <UploadQueueContext.Provider value={value}>
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue(): UploadQueueContextValue {
  const ctx = React.useContext(UploadQueueContext);
  if (!ctx) {
    throw new Error("useUploadQueue must be used inside UploadQueueProvider");
  }
  return ctx;
}
