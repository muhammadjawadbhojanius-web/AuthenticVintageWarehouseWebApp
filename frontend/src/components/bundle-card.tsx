"use client";

import * as React from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Package,
  Trash2,
  Download,
  ClipboardCopy,
  Loader2,
  Layers,
  ThumbsUp,
  ThumbsDown,
  Check,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { countMedia } from "@/lib/media-status";
import { isVideoFilename, mediaUrlFor } from "@/lib/media";
import { useInView } from "@/hooks/use-in-view";
import type { Bundle } from "@/lib/types";

// ---------------------------------------------------------------------------
// Posting status — kept alongside the card because the trigger, the
// dropdown, and the bulk bar all need the same icon / label / colour.
// ---------------------------------------------------------------------------

/** 0 = draft, 1 = posted, 2 = sold. */
export type PostingStatus = 0 | 1 | 2;

interface StatusMeta {
  label: string;
  /** Footer action-button tone (same palette the other actions use). */
  trigger: string;
  /** Colour applied to the icon inside the dropdown menu row. */
  iconTint: string;
}

const STATUS_META: Record<PostingStatus, StatusMeta> = {
  0: {
    label: "Draft",
    trigger: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
    iconTint: "text-muted-foreground",
  },
  1: {
    label: "Posted",
    trigger: "text-success hover:bg-success/10",
    iconTint: "text-success",
  },
  2: {
    label: "Sold",
    // Cash-y amber — distinct from the orange "action" tone used on
    // Copy/Download so Sold doesn't visually blur into them.
    trigger:
      "text-amber-600 hover:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-400/10",
    iconTint: "text-amber-600 dark:text-amber-400",
  },
};

function statusIcon(s: PostingStatus, size: "sm" | "md" = "md"): React.ReactNode {
  const svgClass = size === "md" ? "h-5 w-5" : "h-4 w-4";
  const emojiClass = size === "md" ? "text-xl" : "text-lg";
  switch (s) {
    case 2:
      // 💵 banknote — the user asked for "cash emoji". Using an emoji
      // (not a Lucide icon) keeps the UI instantly readable as Sold.
      return (
        <span className={cn("leading-none", emojiClass)} aria-hidden>
          💵
        </span>
      );
    case 1:
      return <ThumbsUp className={svgClass} />;
    default:
      return <ThumbsDown className={svgClass} />;
  }
}

function coerceStatus(n: unknown): PostingStatus {
  return n === 2 ? 2 : n === 1 ? 1 : 0;
}

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
  /**
   * User picked a new posting status from the dropdown. Current state
   * is on `bundle.posted`. The page decides whether to confirm — any
   * backward move (new rank lower than current) prompts, any forward
   * move fires instantly.
   */
  onChangeStatus?: (next: PostingStatus) => void;
  canDownload?: boolean;
  canDelete?: boolean;
  /** Admin + Listing Executives. Renders the Posted/Draft pill. */
  canManagePosting?: boolean;
  /** True when any item in this bundle has a brand/article not yet approved in the catalog. */
  hasPendingCatalog?: boolean;
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

  // Defer actual media requests until the card is within ~400 px of the
  // viewport. For a long bundle list this turns the startup cost from
  // "one GET per card in the list" into "one GET per card the user
  // actually sees (plus a small read-ahead)". Once a thumb has loaded it
  // stays mounted — `once: true` means we don't tear it down on scroll
  // back up.
  const { ref: thumbRef, inView } = useInView<HTMLDivElement>({
    rootMargin: "400px 0px",
    once: true,
  });

  return (
    <div
      ref={thumbRef}
      className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted"
    >
      {inView && imageSrc ? (
        // Plain <img> — the backend serves same-origin under /api/media
        // with Range-request support, which Safari/iOS require.
        // `loading="lazy"` is a belt-and-braces hint for the browser's
        // own deferred-fetch heuristic on top of our own intersection
        // guard.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : inView && videoSrc ? (
        // Metadata-only preload makes iOS render the first frame as a
        // static poster. `#t=0.1` skips the common black opening frame.
        // <video loading="lazy"> is not a thing, hence the manual gate.
        <video
          src={`${videoSrc}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          className="h-full w-full object-cover"
        />
      ) : !imageSrc && !videoSrc ? (
        <div className="flex h-full w-full items-center justify-center">
          <Package className="h-8 w-8 text-muted-foreground/60" />
        </div>
      ) : null /* off-screen thumb — bg-muted placeholder holds space */}

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
  onChangeStatus,
  canDownload = false,
  canDelete = false,
  canManagePosting = false,
  hasPendingCatalog = false,
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
    !selectionMode &&
    (onCopy ||
      (canDownload && onDownload) ||
      (canDelete && onDelete) ||
      (canManagePosting && onChangeStatus));

  const actionCount =
    (onCopy ? 1 : 0) +
    (canDownload ? 1 : 0) +
    (canManagePosting ? 1 : 0) +
    (canDelete ? 1 : 0);

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
          {/* Top row: code + pending indicator + media badge */}
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate text-base font-bold tracking-tight text-foreground">
              {bundle.bundle_code}
            </h3>
            {hasPendingCatalog && (
              <span title="This bundle has items with brands or articles pending catalog approval">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              </span>
            )}
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
          {canManagePosting && onChangeStatus && (
            <StatusButton
              status={coerceStatus(bundle.posted)}
              onPick={(next) => onChangeStatus(next)}
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

type ActionTone = "action" | "destructive" | "success" | "muted";

interface ActionButtonProps {
  label: string;
  icon: React.ReactNode;
  tone: ActionTone;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
  ariaLabel: string;
}

function toneClasses(tone: ActionTone): string {
  switch (tone) {
    case "action":
      return "text-orange-700 hover:bg-orange-500/5 dark:text-orange-400 dark:hover:bg-orange-400/10";
    case "destructive":
      return "text-red-600 hover:bg-red-500/5 dark:text-red-400 dark:hover:bg-red-400/10";
    case "success":
      // Posted state — green, matches the muted-green media badge so the
      // card reads as "this is live" at a glance.
      return "text-success hover:bg-success/10";
    case "muted":
      // Draft state — subdued, so the footer doesn't shout while the
      // bundle is still being worked on.
      return "text-muted-foreground hover:bg-muted/50 hover:text-foreground";
  }
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
        toneClasses(tone),
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status button + portal dropdown.
//
// Rendered in the footer like the other action buttons, but instead of
// toggling on click it opens a 3-option menu (Draft / Posted / Sold).
// The menu uses createPortal so the Card's overflow-hidden doesn't clip
// it, and falls back to opening upward when there isn't room below.
// ---------------------------------------------------------------------------

interface StatusButtonProps {
  status: PostingStatus;
  onPick: (next: PostingStatus) => void;
}

function StatusButton({ status, onPick }: StatusButtonProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const meta = STATUS_META[status];

  const handleOpen = (e: React.MouseEvent) => {
    // Stop so the Card's own onClick doesn't treat this as a navigate /
    // selection toggle.
    e.stopPropagation();
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  };

  const handlePick = (next: PostingStatus) => {
    setOpen(false);
    // No-op if the user re-picks the current state.
    if (next !== status) onPick(next);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Change status — current: ${meta.label}`}
        className={cn(
          "flex flex-col items-center justify-center gap-1 py-3 text-xs font-semibold transition-colors",
          meta.trigger,
        )}
      >
        {statusIcon(status, "md")}
        <span>{meta.label}</span>
      </button>
      <StatusMenu
        open={open}
        anchorRect={rect}
        current={status}
        onPick={handlePick}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

interface StatusMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  current: PostingStatus;
  onPick: (next: PostingStatus) => void;
  onClose: () => void;
}

function StatusMenu({ open, anchorRect, current, onPick, onClose }: StatusMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !anchorRect || typeof document === "undefined") return null;

  // Rough menu height estimate: 3 rows × 36 px + 8 px padding.
  const menuHeight = 116;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUp = spaceBelow < menuHeight + 8;
  const top = openUp
    ? Math.max(8, anchorRect.top - menuHeight - 4)
    : anchorRect.bottom + 4;
  // Right-anchor so the menu doesn't blow past the right edge on phones
  // where the button sits near the right side of the footer.
  const right = Math.max(8, window.innerWidth - anchorRect.right);

  const options: PostingStatus[] = [0, 1, 2];

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[60] w-44 overflow-hidden rounded-lg border bg-background shadow-lg"
      style={{ top, right }}
    >
      {options.map((s) => {
        const m = STATUS_META[s];
        const active = s === current;
        return (
          <button
            key={s}
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onPick(s);
            }}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-accent",
              active && "bg-accent/50",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center",
                m.iconTint,
              )}
            >
              {statusIcon(s, "md")}
            </span>
            <span className="flex-1 text-left font-medium">{m.label}</span>
            {active && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

// memo so the list page doesn't re-render every card on unrelated state
// changes (selection toggles, copy spinner, etc.). React's default
// shallow prop compare is enough — all props are stable callbacks or
// primitives.
export const BundleCard = memo(BundleCardImpl);
