"use client";

import { memo } from "react";
import { Play, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaThumbProps {
  /**
   * URL the browser can fetch (HTTP for remote, blob: for local).
   * For HTTP URLs an `#t=0.1` fragment is appended for video so the
   * browser seeks past any black initial frame.
   */
  url: string;
  isVideo: boolean;
  alt?: string;
  className?: string;
  /** When clicked, opens full-screen preview. */
  onClick?: () => void;
  /** When clicked, removes the item. Optional. */
  onRemove?: () => void;
  /** Whether the remove handle should be visible. */
  showRemove?: boolean;
}

function MediaThumbImpl({
  url,
  isVideo,
  alt = "",
  className,
  onClick,
  onRemove,
  showRemove,
}: MediaThumbProps) {
  return (
    <div
      className={cn(
        "group relative aspect-square overflow-hidden rounded-md border bg-muted",
        className
      )}
    >
      {isVideo ? (
        // The <video> element will fetch metadata and render the first frame
        // as a static poster. We add #t=0.1 to skip black initial frames on
        // remote URLs (blob: URLs handle this fine without the fragment).
        <video
          src={url.startsWith("blob:") ? url : `${url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          className="h-full w-full cursor-pointer object-cover"
          onClick={onClick}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          className="h-full w-full cursor-pointer object-cover"
          onClick={onClick}
        />
      )}

      {isVideo && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/50 p-2">
            <Play className="h-6 w-6 fill-white text-white" />
          </div>
        </div>
      )}

      {showRemove && onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute right-1 top-1 rounded-full bg-destructive p-1 text-destructive-foreground"
          aria-label="Remove"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export const MediaThumb = memo(MediaThumbImpl);
