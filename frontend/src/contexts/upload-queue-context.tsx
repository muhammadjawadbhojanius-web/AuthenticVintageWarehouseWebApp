"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chunkedUpload, isAbortError } from "@/lib/chunked-upload";
import { compressAndUploadPipelined } from "@/lib/video-compressor";
import { cancelUpload as apiCancelUpload } from "@/lib/queries";

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
  // AbortController for the in-flight axios calls of *this* task. Re-created
  // each time we (re)start processing so a retried task gets a fresh signal.
  abortController?: AbortController;
  // Set of upload_ids whose chunkedUpload promise hasn't resolved yet.
  // Lets cancel() ask the server to clean each one up; entries are removed
  // when their per-file uploadFile() closure resolves successfully.
  liveUploadIds?: Set<string>;
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
  /**
   * Stops an in-flight or queued upload. Aborts any in-flight chunked
   * uploads, asks the server to clean up partial chunk dirs and any
   * BundleImage rows already inserted by this task, then drops the task
   * from the queue.
   */
  cancel: (id: string) => Promise<void>;
  /**
   * Retries a failed task by resetting it to "queued" with a fresh signal
   * and kicking the worker loop. Files that already succeeded earlier in
   * the same task may be re-uploaded as duplicates — the user can delete
   * those manually if any.
   */
  retry: (id: string) => void;
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

        // Fresh abort + tracking set for this run. Stored on the task so
        // cancel() / retry() can find them via the id.
        const abortController = new AbortController();
        const liveUploadIds = new Set<string>();
        next.abortController = abortController;
        next.liveUploadIds = liveUploadIds;

        patch(next.id, { status: "running", label: "Starting…" });

        try {
          await compressAndUploadPipelined({
            files: next.files,
            uploadFile: async (file, onProgress) => {
              let myUploadId: string | null = null;
              try {
                await chunkedUpload({
                  bundleCode: next.bundleCode,
                  file,
                  signal: abortController.signal,
                  onUploadIdReady: (id) => {
                    myUploadId = id;
                    liveUploadIds.add(id);
                  },
                  onUploadProgress: (p) => onProgress(0.85 * p),
                  onProcessProgress: (p) => onProgress(0.85 + 0.15 * p),
                });
              } finally {
                // Whether we resolved or threw, this file's id is no longer
                // in flight. Cancel won't touch it after this point — for
                // success that's correct, for an in-flight failure the
                // server has already finalised state on its own.
                if (myUploadId) liveUploadIds.delete(myUploadId);
              }
            },
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
          // A user-driven cancel reaches us as an AbortError because we
          // wired the AbortSignal through chunkedUpload. cancel() already
          // dropped the task from the queue so we just bail out of the
          // worker loop instead of marking it failed.
          if (isAbortError(err)) {
            // Task may already have been removed by cancel(); patch is a
            // no-op if so.
            continue;
          }
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

  const cancel = React.useCallback(
    async (id: string) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (!task) return;

      // Abort any in-flight axios calls. Per-file uploadFile() closures
      // see this as their AbortSignal firing and reject — caught in
      // processNext's catch.
      task.abortController?.abort();

      // Best-effort server-side cleanup for every still-in-flight file.
      // Done concurrently — failures (network, missing job) are logged and
      // swallowed so cancel always succeeds from the UI's perspective.
      const ids = task.liveUploadIds ? Array.from(task.liveUploadIds) : [];
      if (ids.length > 0) {
        await Promise.allSettled(
          ids.map((uid) => apiCancelUpload(task.bundleCode, uid)),
        );
      }

      // Bundle / detail queries may have shown an in-progress image row;
      // refetch so the UI reflects whatever the server kept (in particular,
      // any BundleImage row inserted before cancel arrived has been removed
      // by the cancel endpoint).
      queryClient.invalidateQueries({ queryKey: ["bundles"] });
      queryClient.invalidateQueries({ queryKey: ["bundle", task.bundleCode] });

      remove(id);
    },
    [queryClient, remove],
  );

  const retry = React.useCallback(
    (id: string) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (!task || task.status !== "failed") return;
      patch(id, {
        status: "queued",
        progress: 0,
        label: "Queued",
        error: undefined,
        finishedAt: undefined,
        abortController: undefined,
        liveUploadIds: undefined,
      });
      void processNext();
    },
    [patch, processNext],
  );

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
    () => ({ tasks, enqueue, dismiss, cancel, retry, hasActive }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks.length, tasks.map((t) => `${t.id}:${t.status}:${t.progress.toFixed(3)}:${t.label}`).join("|"), enqueue, dismiss, cancel, retry, hasActive],
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
