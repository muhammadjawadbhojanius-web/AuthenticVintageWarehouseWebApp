import { isVideoFilename } from "./media";

export interface MediaCounted {
  photos: number;
  videos: number;
}

/** Split a bundle's media list into photo / video counts. */
export function countMedia(images: { image_path: string }[] = []): MediaCounted {
  let photos = 0;
  let videos = 0;
  for (const img of images) {
    const name = img.image_path.split("/").pop() || "";
    if (isVideoFilename(name)) videos++;
    else photos++;
  }
  return { photos, videos };
}

/**
 * Human-readable label describing a bundle's media composition.
 * Examples: "No media", "1 photo", "3 videos", "2 photos and 1 video".
 */
export function mediaStatusLabel(images: { image_path: string }[] = []): string {
  const { photos, videos } = countMedia(images);
  if (photos === 0 && videos === 0) return "No media";
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} ${photos === 1 ? "photo" : "photos"}`);
  if (videos > 0) parts.push(`${videos} ${videos === 1 ? "video" : "videos"}`);
  return parts.join(" and ");
}
