/**
 * iOS Safari is the only browser that won't save downloaded files to Photos
 * via a regular `<a download>` — it dumps them in the Files app instead.
 * The workaround is the Web Share API, which surfaces a native sheet with
 * "Save Image" / "Save Video" options. The Share call MUST happen inside
 * a user gesture, so we pre-fetch the blob in advance and let the user tap
 * a button (in our iOS bottom sheet) to invoke share().
 */

export function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPhone / iPod / older iPad UA strings
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPad on iPadOS 13+ reports as Mac with touch points
  if (
    typeof navigator.maxTouchPoints === "number" &&
    navigator.platform === "MacIntel" &&
    navigator.maxTouchPoints > 1
  )
    return true;
  return false;
}

export async function fetchAsFile(url: string, filename: string): Promise<File> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const blob = await res.blob();
  let mime = blob.type;
  if (!mime || mime === "application/octet-stream") {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".mp4")) mime = "video/mp4";
    else if (lower.endsWith(".mov")) mime = "video/quicktime";
    else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
    else if (lower.endsWith(".png")) mime = "image/png";
    else if (lower.endsWith(".webp")) mime = "image/webp";
  }
  return new File([blob], filename, { type: mime });
}

export async function shareFile(file: File): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.share || !navigator.canShare) return false;
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: file.name });
    return true;
  } catch {
    // user cancelled
    return false;
  }
}

export function anchorDownload(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}
