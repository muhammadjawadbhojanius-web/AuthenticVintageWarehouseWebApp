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
  } = opts;

  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const client = api();

  // 1) Init upload
  const initRes = await client.post<{ upload_id: string }>(
    `/bundles/${encodeURIComponent(bundleCode)}/uploads/init`,
    { filename, total_size: file.size, total_chunks: totalChunks }
  );
  const uploadId = initRes.data.upload_id;

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
    `/bundles/${encodeURIComponent(bundleCode)}/uploads/${uploadId}/finalize`
  );

  // 4) Poll status. Without backend re-encoding this typically completes
  // on the very first poll.
  while (true) {
    await new Promise((r) => setTimeout(r, statusPollMs));
    const res = await client.get<UploadJobStatusResponse>(
      `/bundles/${encodeURIComponent(bundleCode)}/uploads/${uploadId}/status`
    );
    const { status, progress, error } = res.data;
    onProcessProgress?.(progress);
    if (status === "completed") return;
    if (status === "failed") throw new Error(error || "Server processing failed");
  }
}

// ─── Multi-file parallel upload helper ───────────────────────────────────

export interface ParallelUploadOptions {
  bundleCode: string;
  files: File[];
  /** How many files to upload concurrently. Default: 2. */
  fileConcurrency?: number;
  /**
   * Called whenever any file makes progress. `overall` is 0..1 across all
   * files combined. `label` is a short human-readable status string for
   * the UI.
   */
  onProgress?: (info: { overall: number; label: string }) => void;
}

/**
 * Uploads many files concurrently via `chunkedUpload`. Both file-level
 * concurrency and chunk-level concurrency add up to "everything in flight
 * at once" without overwhelming the device.
 */
export async function uploadFilesParallel(opts: ParallelUploadOptions): Promise<void> {
  const { bundleCode, files, fileConcurrency = 2, onProgress } = opts;
  if (files.length === 0) return;

  // Per-file progress, weighted by file size so a tiny image doesn't
  // skew the overall percentage.
  const sizes = files.map((f) => f.size || 1);
  const totalSize = sizes.reduce((a, b) => a + b, 0);
  const fileProgress = new Array(files.length).fill(0);
  const fileLabels = new Array(files.length).fill("Waiting");

  const emit = () => {
    if (!onProgress) return;
    let weighted = 0;
    for (let i = 0; i < files.length; i++) {
      weighted += fileProgress[i] * (sizes[i] / totalSize);
    }
    // Pick the most recent active label (the lowest-index file that's
    // still in progress). Falls back to the last label if everything is
    // done.
    let activeLabel = fileLabels[fileLabels.length - 1];
    for (let i = 0; i < files.length; i++) {
      if (fileProgress[i] < 1) {
        activeLabel = fileLabels[i];
        break;
      }
    }
    onProgress({ overall: weighted, label: activeLabel });
  };

  let nextFileIdx = 0;

  const worker = async () => {
    while (true) {
      const idx = nextFileIdx++;
      if (idx >= files.length) return;
      const f = files[idx];
      const human = `${f.name} (${idx + 1}/${files.length})`;
      fileLabels[idx] = `Uploading ${human}`;
      emit();

      try {
        await chunkedUpload({
          bundleCode,
          file: f,
          // Per-file: 0..0.85 = upload, 0.85..1.0 = server processing.
          onUploadProgress: (p) => {
            fileProgress[idx] = 0.85 * p;
            fileLabels[idx] = `Uploading ${human}`;
            emit();
          },
          onProcessProgress: (p) => {
            fileProgress[idx] = 0.85 + 0.15 * p;
            fileLabels[idx] = `Processing ${human}`;
            emit();
          },
        });
        fileProgress[idx] = 1;
        fileLabels[idx] = `Done ${human}`;
        emit();
      } catch (e) {
        // Re-throw to fail the whole bundle submit. The caller's catch
        // will surface the error to the user.
        throw new Error(`Upload failed for ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(fileConcurrency, files.length) }, worker)
  );
}
