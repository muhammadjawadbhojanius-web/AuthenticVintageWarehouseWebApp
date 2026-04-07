import { resolveBaseUrl } from "./api";

/**
 * Builds the absolute URL for a media file given its `image_path` from the
 * backend (e.g. "uploads/CODE/file.jpg"). The backend serves files at
 * `/media/...` for byte-range support, so we replace the prefix.
 */
export function mediaUrlFor(imagePath: string): string {
  const mediaPath = imagePath.replace(/^uploads\//, "media/");
  const base = resolveBaseUrl();
  // Ensure exactly one slash between base and path
  const sep = base.endsWith("/") ? "" : "/";
  return `${base}${sep}${mediaPath}`;
}

export function isVideoFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return [".mp4", ".mov", ".avi", ".mkv", ".3gp", ".webm", ".wmv"].some((ext) =>
    lower.endsWith(ext)
  );
}
