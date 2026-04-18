import type { BundleImage } from "./types";
import { mediaUrlFor, isVideoFilename } from "./media";
import { fetchAsFile } from "./download";

/**
 * iOS Safari will only trigger navigator.share() inside a fresh user
 * gesture. Fetching can take many seconds, so we pre-download every
 * file in a bundle up-front as blobs, hand them to the dialog, and let
 * the user's per-file Save tap be the new user gesture that dispatches
 * share().
 */

export interface PrefetchedMedia {
  image: BundleImage;
  file: File;
  fileName: string;
  isVideo: boolean;
}

export async function prefetchBundleMedia(
  images: BundleImage[],
  opts: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    concurrency?: number;
  } = {},
): Promise<PrefetchedMedia[]> {
  const total = images.length;
  const results: (PrefetchedMedia | null)[] = new Array(total).fill(null);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 2, total));
  let completed = 0;
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= total) return;
      const img = images[i];
      const fileName = img.image_path.split("/").pop() || "file";
      const url = `${mediaUrlFor(img.image_path)}?download=true`;
      const file = await fetchAsFile(url, fileName, { signal: opts.signal });
      results[i] = {
        image: img,
        file,
        fileName,
        isVideo: isVideoFilename(fileName),
      };
      completed += 1;
      opts.onProgress?.(completed, total);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results.filter((r): r is PrefetchedMedia => r !== null);
}
