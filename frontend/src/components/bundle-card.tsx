"use client";

import { memo, useMemo, useRef } from "react";
import { Package, Trash2, Download, ClipboardCopy, Loader2, Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { countMedia } from "@/lib/media-status";
import { isVideoFilename, mediaUrlFor } from "@/lib/media";
import type { Bundle } from "@/lib/types";

export interface BundleCardProps {
  bundle: Bundle;
  selected?: boolean;
  selectionMode?: boolean;
  isUploading?: boolean;
  copying?: boolean;
  /** iOS-only — we're pre-fetching all media before opening the download dialog. */
  preparingDownload?: boolean;
  onClick?: () => void;
  onLongPress?: () => void;
  onSelectionChange?: (next: boolean) => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  canDownload?: boolean;
  canDelete?: boolean;
}

function formatDate(s?: string): string {
  if (!s) return "";
  try {
    const dt = new Date(s);
    return dt.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return s;
  }
}

/** Short badge label: "3 PHOTOS", "2 VIDEOS", "3 PHOTOS + 1 VIDEO", "NO MEDIA". */
function mediaBadgeLabel(photos: number, videos: number): string {
  if (photos === 0 && videos === 0) return "NO MEDIA";
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} ${photos === 1 ? "PHOTO" : "PHOTOS"}`);
  if (videos > 0) parts.push(`${videos} ${videos === 1 ? "VIDEO" : "VIDEOS"}`);
  return parts.join(" + ");
}

interface ThumbnailProps {
  bundle: Bundle;
  isUploading: boolean;
  selectionMode: boolean;
  selected: boolean;
  onSelectionChange?: (next: boolean) => void;
}

function Thumbnail({
  bundle,
  isUploading,
  selectionMode,
  selected,
  onSelectionChange,
}: ThumbnailProps) {
  // Prefer a still image; fall back to the first video (rendered as a
  // <video> element so iOS shows its poster frame). If nothing exists,
  // show a placeholder.
  const { imageSrc, videoSrc } = useMemo(() => {
    let img: string | null = null;
    let vid: string | null = null;
    for (const m of bundle.images ?? []) {
      const name = m.image_path.split("/").pop() || "";
      if (isVideoFilename(name)) {
        if (!vid) vid = mediaUrlFor(m.image_path);
      } else if (!img) {
        img = mediaUrlFor(m.image_path);
      }
      if (img) break;
    }
    return { imageSrc: img, videoSrc: vid };
  }, [bundle.images]);

  return (
    <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
      {imageSrc ? (
        // Plain <img> — the backend serves same-origin under /api/media
        // with Range-request support, which Safari/iOS require.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      ) : videoSrc ? (
        // Metadata-only preload makes iOS render the first frame as a
        // static poster. `#t=0.1` skips the common black opening frame.
        <video
          src={`${videoSrc}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Package className="h-8 w-8 text-muted-foreground/60" />
        </div>
      )}

      {/* Upload-in-progress veil */}
      {isUploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Selection-mode overlay checkbox */}
      {selectionMode && (
        <div
          className={cn(
            "absolute inset-0 flex items-start justify-start p-1.5",
            selected ? "bg-primary/25" : "bg-background/40"
          )}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onSelectionChange?.(v)}
            // Only force a light background when the checkbox is empty —
            // otherwise it would override bg-primary and hide the tick.
            className={cn(
              "shadow-sm",
              !selected && "bg-background"
            )}
          />
        </div>
      )}
    </div>
  );
}

function BundleCardImpl({
  bundle,
  selected = false,
  selectionMode = false,
  isUploading = false,
  copying = false,
  preparingDownload = false,
  onClick,
  onLongPress,
  onSelectionChange,
  onDownload,
  onDelete,
  onCopy,
  canDownload = false,
  canDelete = false,
}: BundleCardProps) {
  // Refs (not state) so we don't trigger re-renders and so the values are
  // read synchronously by handlers that might fire between state flushes.
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After a long-press fires, mobile browsers also emit a synthetic click
  // on touch release. We swallow that next click so it doesn't navigate.
  const suppressClickRef = useRef(false);

  const handleTouchStart = () => {
    if (!onLongPress) return;
    suppressClickRef.current = false;
    const t = setTimeout(() => {
      onLongPress();
      suppressClickRef.current = true;
      // Auto-clear in case no synthetic click arrives — 500 ms is safely
      // past the window in which the click event would fire.
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 500);
      pressTimerRef.current = null;
    }, 600);
    pressTimerRef.current = t;
  };
  const cancelLongPress = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const handleCardClick = () => {
    if (suppressClickRef.current) {
      // This click is the follow-up to a long-press. Drop it.
      suppressClickRef.current = false;
      return;
    }
    if (selectionMode) {
      // In selection mode, tapping anywhere on the card toggles this
      // bundle's selection. We call onSelectionChange directly — the
      // prop is always current, unlike the parent's onClick closure
      // which can hold a stale `selectionMode` value right after
      // long-press transitions.
      onSelectionChange?.(!selected);
      return;
    }
    onClick?.();
  };

  const { photos, videos } = countMedia(bundle.images);
  const hasMedia = photos + videos > 0;
  const totalPieces = (bundle.items ?? []).reduce(
    (s, i) => s + (i.number_of_pieces || 0),
    0
  );

  const showActionRow =
    !selectionMode && (onCopy || (canDownload && onDownload) || (canDelete && onDelete));

  const actionCount =
    (onCopy ? 1 : 0) + (canDownload ? 1 : 0) + (canDelete ? 1 : 0);

  return (
    <Card
      className={cn(
        "flex flex-col overflow-hidden cursor-pointer transition-all",
        "hover:shadow-md hover:border-foreground/20",
        selected && "border-primary ring-2 ring-primary/30"
      )}
      onClick={handleCardClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault();
          suppressClickRef.current = true;
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 500);
          onLongPress();
        }
      }}
    >
      {/* Body — thumbnail + identity + metadata */}
      <div className="flex items-stretch gap-3 p-3">
        <Thumbnail
          bundle={bundle}
          isUploading={isUploading}
          selectionMode={selectionMode}
          selected={selected}
          onSelectionChange={onSelectionChange}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top row: code + media badge */}
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate text-base font-bold tracking-tight text-foreground">
              {bundle.bundle_code}
            </h3>
            <span
              className={cn(
                "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide",
                isUploading
                  ? "bg-warning/15 text-warning"
                  : hasMedia
                    ? "bg-success/15 text-success"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {isUploading ? "UPLOADING" : mediaBadgeLabel(photos, videos)}
            </span>
          </div>

          {/* Italic quoted name */}
          {bundle.bundle_name && (
            <p className="mt-0.5 truncate text-sm italic text-muted-foreground">
              &lsquo;{bundle.bundle_name}&rsquo;
            </p>
          )}

          {/* Bottom metadata row: pieces count (left) + date (right) */}
          <div className="mt-auto flex items-end justify-between gap-2 pt-2 text-xs text-muted-foreground">
            {totalPieces > 0 ? (
              <span className="inline-flex items-center gap-1 font-medium">
                <Layers className="h-3.5 w-3.5" />
                <span className="tabular-nums">{totalPieces}</span>
                <span>{totalPieces === 1 ? "piece" : "pieces"}</span>
              </span>
            ) : (
              <span />
            )}
            <span className="tabular-nums">{formatDate(bundle.created_at)}</span>
          </div>
        </div>
      </div>

      {/* Action footer — symmetric equal-width columns */}
      {showActionRow && actionCount > 0 && (
        <div
          className="grid divide-x border-t"
          style={{ gridTemplateColumns: `repeat(${actionCount}, minmax(0, 1fr))` }}
        >
          {onCopy && (
            <ActionButton
              label="Copy"
              icon={
                copying ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ClipboardCopy className="h-5 w-5" />
                )
              }
              tone="action"
              disabled={copying}
              onClick={(e) => {
                e.stopPropagation();
                onCopy();
              }}
              ariaLabel="Copy bundle details"
            />
          )}
          {canDownload && (
            <ActionButton
              label={preparingDownload ? "Preparing" : "Download"}
              icon={
                preparingDownload ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Download className="h-5 w-5" />
                )
              }
              tone="action"
              disabled={preparingDownload}
              onClick={(e) => {
                e.stopPropagation();
                onDownload?.();
              }}
              ariaLabel="Download bundle"
            />
          )}
          {canDelete && (
            <ActionButton
              label="Delete"
              icon={<Trash2 className="h-5 w-5" />}
              tone="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.();
              }}
              ariaLabel="Delete bundle"
            />
          )}
        </div>
      )}
    </Card>
  );
}

interface ActionButtonProps {
  label: string;
  icon: React.ReactNode;
  tone: "action" | "destructive";
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
  ariaLabel: string;
}

function ActionButton({
  label,
  icon,
  tone,
  disabled,
  onClick,
  ariaLabel,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col items-center justify-center gap-1 py-3 text-xs font-semibold transition-colors",
        "disabled:pointer-events-none disabled:opacity-60",
        tone === "action"
          ? "text-orange-700 hover:bg-orange-500/5 dark:text-orange-400 dark:hover:bg-orange-400/10"
          : "text-red-600 hover:bg-red-500/5 dark:text-red-400 dark:hover:bg-red-400/10"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// memo so the list page doesn't re-render every card on unrelated state
// changes (selection toggles, copy spinner, etc.). React's default
// shallow prop compare is enough — all props are stable callbacks or
// primitives.
export const BundleCard = memo(BundleCardImpl);
