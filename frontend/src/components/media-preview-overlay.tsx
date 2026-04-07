"use client";

import * as React from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export interface PreviewItem {
  url: string;
  isVideo: boolean;
  name?: string;
}

interface MediaPreviewOverlayProps {
  items: PreviewItem[];
  index: number;
  onChangeIndex: (next: number) => void;
  onClose: () => void;
}

/**
 * Full-screen media viewer with prev/next/Esc support. Renders nothing
 * when items is empty or index is out of range.
 */
export function MediaPreviewOverlay({
  items,
  index,
  onChangeIndex,
  onClose,
}: MediaPreviewOverlayProps) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onChangeIndex(index - 1);
      else if (e.key === "ArrowRight" && index < items.length - 1)
        onChangeIndex(index + 1);
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [index, items.length, onChangeIndex, onClose]);

  if (items.length === 0 || index < 0 || index >= items.length) return null;
  const current = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between p-4">
        <span className="text-sm font-medium text-white/80">
          {index + 1} / {items.length}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label="Close preview"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Prev */}
      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChangeIndex(index - 1);
          }}
          className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label="Previous"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {/* Next */}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChangeIndex(index + 1);
          }}
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label="Next"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {current.isVideo ? (
        <video
          src={current.url}
          controls
          autoPlay
          playsInline
          className="max-h-screen max-w-full"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={current.url}
          alt={current.name || ""}
          className="max-h-screen max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}
