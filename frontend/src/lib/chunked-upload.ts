import { api } from "./api";
import type { UploadJobStatusResponse } from "./types";

// 10 MB chunks. The nginx client_max_body_size is 20 MB so this fits with
// plenty of headroom for the multipart envelope.
const CHUNK_SIZE = 10 * 1024 * 1024;

// How many chunks of a single file to upload in parallel. 3 is the sweet
// spot for LAN throughput without saturating any one connection's TCP
// window.
const CHUNK_CONCURRENCY = 3;

export interface ChunkedUploadOptions {
  bundleCode: string;
  file: File;
  filename?: string;
  /** Called after each chunk uploads (0..1, only the upload phase). */
  onUploadProgress?: (progress: number) => void;
  /** Called while server-side processing runs (0..1). */
  onProcessProgress?: (progress: number) => void;
  /** Polling interval for status checks while processing. */
  statusPollMs?: number;
  /**
   * Aborts every in-flight axios call (init, chunks, finalize, status
   * poll). When the signal fires, this function rejects with the
   * abort/canceled error from the underlying axios layer; callers should
   * treat that as a clean shutdown rather than an upload failure.
   */
  signal?: AbortSignal;
  /**
   * Fires once, immediately after the init POST returns the upload_id.
   * Lets the caller register the id for server-side cancel cleanup while
   * the upload is still in progress (we can't return it until the whole
   * function resolves, which may be minutes later for a video).
   */
  onUploadIdReady?: (uploadId: string) => void;
}

/**
 * Uploads a single file via the chunked-upload endpoints. Chunks within
 * the file are sent in parallel (up to CHUNK_CONCURRENCY in flight at
 * once) and the function only resolves once the server-side job reaches
 * `completed`.
 */
export async function chunkedUpload(opts: ChunkedUploadOptions): Promise<void> {
  const {
    bundleCode,
    file,
    filename = file.name,
    onUploadProgress,
    onProcessProgress,
    statusPollMs = 1500,
    signal,
    onUploadIdReady,
  } = opts;

  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const client = api();

  // Throws if the caller's AbortController has fired. Used in the
  // status-poll loop where there's no axios call to carry the signal.
  const throwIfAborted = () => {
    if (signal?.aborted) {
      const reason = signal.reason;
      throw reason instanceof Error
        ? reason
        : new DOMException("Upload cancelled", "AbortError");
    }
  };

  // 1) Init upload
  const initRes = await client.post<{ upload_id: string }>(
    `/bundles/${encodeURIComponent(bundleCode)}/uploads/init`,
    { filename, total_size: file.size, total_chunks: totalChunks },
    { signal }
  );
  const uploadId = initRes.data.upload_id;
  onUploadIdReady?.(uploadId);

  // 2) Upload chunks with bounded parallelism
  let nextIndex = 0;
  let completed = 0;

  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= totalChunks) return;
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      const form = new FormData();
      form.append("chunk", chunk, `${i}.part`);
      await client.put(
        `/bundles/${encodeURIComponent(bundleCode)}/uploads/${uploadId}/chunk?index=${i}`,
        form,
        {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 600_000, // big chunks on a slow link need a long ceiling
          signal,
        }
      );
      completed++;
      onUploadProgress?.(completed / totalChunks);
    }
  };

  // Run CHUNK_CONCURRENCY workers in parallel; Promise.all rejects fast on
  // any chunk failure
  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, totalChunks) }, worker)
  );

  // 3) Finalize → server starts the (now lightweight) background task
  await client.post(
    `/bundles/${encodeURIComponent(bundleCode)}/uploads/${uploadId}/finalize`,
    undefined,
    { signal }
  );

  // 4) Poll status. Without backend re-encoding this typically completes
  // on the very first poll.
  while (true) {
    await new Promise((r) => setTimeout(r, statusPollMs));
    throwIfAborted();
    const res = await client.get<UploadJobStatusResponse>(
      `/bundles/${encodeURIComponent(bundleCode)}/uploads/${uploadId}/status`,
      { signal }
    );
    const { status, progress, error } = res.data;
    onProcessProgress?.(progress);
    if (status === "completed") return;
    if (status === "failed") throw new Error(error || "Server processing failed");
    if (status === "cancelled")
      throw new DOMException("Upload cancelled", "AbortError");
  }
}

/**
 * True for axios-cancel and DOMException AbortError shapes so callers can
 * suppress "Failed" UI when the abort came from their own cancel button.
 */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string; message?: string };
  if (e.name === "AbortError" || e.name === "CanceledError") return true;
  if (e.code === "ERR_CANCELED") return true;
  return false;
}

