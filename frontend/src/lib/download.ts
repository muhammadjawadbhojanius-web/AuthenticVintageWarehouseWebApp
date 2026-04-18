// ---------------------------------------------------------------------------
// Centralized download logic.
//
// Browser sandboxes behave very differently when a web page tries to
// write a file to the user's photo library. This module picks the right
// path per device:
//
//   iOS (any browser — they're all WebKit under the hood):
//     Photos access requires navigator.share({ files }) fired under a
//     real user gesture. That means the file must already be in memory
//     as a blob at the moment the share button is tapped, so callers
//     pre-fetch with fetchAsFile() and only then surface the Save button.
//
//   Android (Chrome, Samsung, Firefox, …) and every desktop browser:
//     Hand the direct server URL to a programmatic <a download> click.
//     The backend response carries Content-Disposition: attachment, so
//     the browser's built-in download manager takes over. On Android the
//     file lands in /Download and is indexed by MediaStore, which makes
//     it appear in the Gallery / Google Photos. Nothing is buffered in
//     page memory, which eliminates the "blob-anchor click silently
//     dropped" failure mode we were hitting on Android Chrome.
// ---------------------------------------------------------------------------

export type DownloadDevice = "ios" | "native";

/** Detects iOS (incl. iPadOS 13+ which reports as Mac with touch points). */
export function detectDevice(): DownloadDevice {
  if (typeof navigator === "undefined") return "native";
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (
    typeof navigator.maxTouchPoints === "number" &&
    navigator.platform === "MacIntel" &&
    navigator.maxTouchPoints > 1
  ) {
    return "ios";
  }
  return "native";
}

/**
 * Hands a direct URL to the browser's download manager. Use this for
 * Android and desktop. Never throws.
 *
 * The server must serve the URL with Content-Disposition: attachment —
 * our /api/media/...?download=true endpoint already does that.
 */
export function nativeDownload(url: string, fileName: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Remove on the next tick so every browser observes the click.
  setTimeout(() => {
    try {
      a.remove();
    } catch {
      // ignore
    }
  }, 100);
}

export type ShareOutcome = "shared" | "cancelled" | "unsupported";

/**
 * iOS path. Must be called synchronously inside a user gesture — the
 * caller's onClick handler is fine, an awaited fetch before this call
 * is NOT (Safari will reject with NotAllowedError).
 */
export async function shareFile(file: File): Promise<ShareOutcome> {
  if (typeof navigator === "undefined") return "unsupported";
  if (typeof navigator.share !== "function") return "unsupported";
  if (
    typeof navigator.canShare === "function" &&
    !navigator.canShare({ files: [file] })
  ) {
    return "unsupported";
  }
  try {
    await navigator.share({ files: [file], title: file.name });
    return "shared";
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "AbortError" || name === "NotAllowedError") return "cancelled";
    // TypeErrors from the older Safari share implementation mean the file
    // type isn't shareable — treat as unsupported so callers can fall back.
    return "unsupported";
  }
}

export interface FetchAsFileOptions {
  signal?: AbortSignal;
  /** Invoked with 0..1 while Content-Length is known. */
  onProgress?: (fraction: number) => void;
}

/**
 * Streams a URL into a File blob. Used on iOS before navigator.share
 * so the blob sits in memory ready for the user's Save tap.
 */
export async function fetchAsFile(
  url: string,
  fileName: string,
  opts: FetchAsFileOptions = {},
): Promise<File> {
  const res = await fetch(url, { credentials: "omit", signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${fileName}`);
  const mime = inferMime(fileName, res.headers.get("Content-Type") || "");
  const total = Number(res.headers.get("Content-Length") || 0);
  const reader = res.body?.getReader();

  if (!reader) {
    const blob = await res.blob();
    opts.onProgress?.(1);
    return new File([blob], fileName, { type: mime });
  }

  const chunks: BlobPart[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // Copy into a fresh ArrayBuffer-backed Uint8Array so the BlobPart
    // type check is satisfied consistently across TS lib variants.
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    chunks.push(copy);
    received += value.byteLength;
    if (total > 0) opts.onProgress?.(Math.min(received / total, 0.99));
  }
  opts.onProgress?.(1);
  const blob = new Blob(chunks, { type: mime });
  return new File([blob], fileName, { type: mime });
}

function inferMime(fileName: string, hint: string): string {
  if (hint && hint !== "application/octet-stream") return hint;
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}
