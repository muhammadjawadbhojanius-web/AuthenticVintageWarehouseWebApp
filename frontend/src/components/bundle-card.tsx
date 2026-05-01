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
  Image as ImageIcon,
  Video as VideoIcon,
  MapPin,
  Gift,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { countMedia } from "@/lib/media-status";
import { isVideoFilename, mediaUrlFor } from "@/lib/media";
import { useInView } from "@/hooks/use-in-view";
import type { Bundle } from "@/lib/types";

// ---------------------------------------------------------------------------
// Posting status
// ---------------------------------------------------------------------------

/** 0 = draft, 1 = posted, 2 = sold. */
export type PostingStatus = 0 | 1 | 2;

interface StatusMeta {
  label: string;
  trigger: string;
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
    // Use primary (amber) so it automatically adapts to both modes
    trigger: "text-primary hover:bg-primary/10",
    iconTint: "text-primary",
  },
};

function statusIcon(s: PostingStatus, size: "sm" | "md" = "md"): React.ReactNode {
  const svgClass   = size === "md" ? "h-5 w-5" : "h-4 w-4";
  const emojiClass = size === "md" ? "text-xl"  : "text-lg";
  switch (s) {
    case 2:
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
  preparingDownload?: boolean;
  onClick?: () => void;
  onLongPress?: () => void;
  onSelectionChange?: (next: boolean) => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onChangeStatus?: (next: PostingStatus) => void;
  canDownload?: boolean;
  canDelete?: boolean;
  canManagePosting?: boolean;
  hasPendingCatalog?: boolean;
}

function formatDate(s?: string): string {
  if (!s) return "";
  try {
    return new Date(s).toLocaleString(undefined, {
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

function MediaBadgeContent({ photos, videos }: { photos: number; videos: number }) {
  if (photos === 0 && videos === 0) {
    return <span>NO MEDIA</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {photos > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <ImageIcon className="h-3 w-3" aria-hidden />
          <span className="tabular-nums">{photos}</span>
          <span className="sr-only">{photos === 1 ? "photo" : "photos"}</span>
        </span>
      )}
      {videos > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <VideoIcon className="h-3 w-3" aria-hidden />
          <span className="tabular-nums">{videos}</span>
          <span className="sr-only">{videos === 1 ? "video" : "videos"}</span>
        </span>
      )}
    </span>
  );
}

interface ThumbnailProps {
  bundle: Bundle;
  isUploading: boolean;
  selectionMode: boolean;
  selected: boolean;
  onSelectionChange?: (next: boolean) => void;
}

function Thumbnail({ bundle, isUploading, selectionMode, selected, onSelectionChange }: ThumbnailProps) {
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

  const { ref: thumbRef, inView } = useInView<HTMLDivElement>({
    rootMargin: "400px 0px",
    once: true,
  });

  return (
    <div
      ref={thumbRef}
      className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md bg-muted"
    >
      {inView && imageSrc ? (
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
        <video
          src={`${videoSrc}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          className="h-full w-full object-cover"
        />
      ) : !imageSrc && !videoSrc ? (
        <div className="flex h-full w-full items-center justify-center">
          <Package className="h-7 w-7 text-muted-foreground/25" />
        </div>
      ) : null}

      {/* Upload-in-progress veil */}
      {isUploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/75 backdrop-blur-sm">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {/* Selection-mode overlay */}
      {selectionMode && (
        <div
          className={cn(
            "absolute inset-0 flex items-start justify-start p-1.5",
            selected ? "bg-primary/20" : "bg-background/40",
          )}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onSelectionChange?.(v)}
            className={cn("shadow-sm", !selected && "bg-background")}
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
  const pressTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);

  const handleTouchStart = () => {
    if (!onLongPress) return;
    suppressClickRef.current = false;
    const t = setTimeout(() => {
      onLongPress();
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 500);
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
      suppressClickRef.current = false;
      return;
    }
    if (selectionMode) {
      onSelectionChange?.(!selected);
      return;
    }
    onClick?.();
  };

  const { photos, videos } = countMedia(bundle.images);
  const hasMedia    = photos + videos > 0;
  const totalPieces = (bundle.items ?? []).reduce((s, i) => s + (i.number_of_pieces || 0), 0);
  const totalGift   = (bundle.items ?? []).reduce((s, i) => s + (i.gift_pcs || 0), 0);
  const location    = bundle.location?.trim();

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
        "flex flex-col overflow-hidden cursor-pointer",
        "transition-all duration-200",
        "hover:border-border/80 hover:shadow-card-hover",
        selected && "border-primary/50 ring-2 ring-primary/15",
      )}
      onClick={handleCardClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault();
          suppressClickRef.current = true;
          setTimeout(() => { suppressClickRef.current = false; }, 500);
          onLongPress();
        }
      }}
    >
      {/* ── Card body: thumbnail + identity ──────────────────────────────── */}
      <div className="flex items-stretch gap-3 p-3">
        <Thumbnail
          bundle={bundle}
          isUploading={isUploading}
          selectionMode={selectionMode}
          selected={selected}
          onSelectionChange={onSelectionChange}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top row: code + badges */}
          <div className="flex items-start gap-2">
            {/* Bundle code — the primary identifier, rendered in monospace amber */}
            <h3 className="min-w-0 flex-1 truncate font-mono text-sm font-bold tracking-tight text-primary">
              {bundle.bundle_code}
            </h3>

            {hasPendingCatalog && (
              <span title="Items with brands or articles pending catalog approval">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              </span>
            )}

            {/* Right column: media count + location */}
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span
                className={cn(
                  "label-stamp rounded px-1.5 py-0.5",
                  isUploading
                    ? "text-warning"
                    : hasMedia
                      ? "text-success"
                      : "text-muted-foreground/60",
                )}
              >
                {isUploading ? "uploading" : <MediaBadgeContent photos={photos} videos={videos} />}
              </span>

              {location && (
                <span
                  title="Warehouse location"
                  className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary"
                >
                  <MapPin className="h-2.5 w-2.5" aria-hidden />
                  <span className="font-mono">{location}</span>
                </span>
              )}
            </div>
          </div>

          {/* Bundle name — italic, subdued */}
          {bundle.bundle_name && (
            <p className="mt-0.5 truncate text-xs italic text-muted-foreground">
              &lsquo;{bundle.bundle_name}&rsquo;
            </p>
          )}

          {/* Bottom row: piece counts + date */}
          <div className="mt-auto flex items-end justify-between gap-2 pt-2 text-[11px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {totalPieces > 0 && (
                <span className="inline-flex items-center gap-1 font-medium">
                  <Layers className="h-3 w-3" />
                  <span className="tabular-nums font-mono">{totalPieces}</span>
                  <span>pcs</span>
                </span>
              )}
              {totalGift > 0 && (
                <span className="inline-flex items-center gap-1 font-medium" title="Gift pieces">
                  <Gift className="h-3 w-3" />
                  <span className="tabular-nums font-mono">{totalGift}</span>
                  <span>pcs</span>
                </span>
              )}
            </div>
            <span className="tabular-nums font-mono text-[10px]">{formatDate(bundle.created_at)}</span>
          </div>
        </div>
      </div>

      {/* ── Action footer ─────────────────────────────────────────────────── */}
      {showActionRow && actionCount > 0 && (
        <div
          className="grid divide-x divide-border/40 border-t border-border/40"
          style={{ gridTemplateColumns: `repeat(${actionCount}, minmax(0, 1fr))` }}
        >
          {onCopy && (
            <ActionButton
              label="Copy"
              icon={copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCopy className="h-4 w-4" />}
              tone="action"
              disabled={copying}
              onClick={(e) => { e.stopPropagation(); onCopy(); }}
              ariaLabel="Copy bundle details"
            />
          )}
          {canDownload && (
            <ActionButton
              label={preparingDownload ? "Preparing" : "Download"}
              icon={preparingDownload ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              tone="action"
              disabled={preparingDownload}
              onClick={(e) => { e.stopPropagation(); onDownload?.(); }}
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
              icon={<Trash2 className="h-4 w-4" />}
              tone="destructive"
              onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
              ariaLabel="Delete bundle"
            />
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

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
      return "text-primary hover:bg-primary/10";
    case "destructive":
      return "text-destructive hover:bg-destructive/10";
    case "success":
      return "text-success hover:bg-success/10";
    case "muted":
      return "text-muted-foreground hover:bg-muted/50 hover:text-foreground";
  }
}

function ActionButton({ label, icon, tone, disabled, onClick, ariaLabel }: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col items-center justify-center gap-1 py-2.5",
        "text-[10px] font-bold tracking-widest uppercase",
        "transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-50",
        toneClasses(tone),
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status button + portal dropdown
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
    e.stopPropagation();
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  };

  const handlePick = (next: PostingStatus) => {
    setOpen(false);
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
          "flex flex-col items-center justify-center gap-1 py-2.5",
          "text-[10px] font-bold tracking-widest uppercase",
          "transition-colors duration-150",
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

const STATUS_OPTIONS: PostingStatus[] = [0, 1, 2];

function StatusMenu({ open, anchorRect, current, onPick, onClose }: StatusMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const options = STATUS_OPTIONS;
  const [focusIdx, setFocusIdx] = useState<number>(() =>
    Math.max(0, options.indexOf(current))
  );

  // Reset focus to the currently-selected item whenever the menu opens.
  useEffect(() => {
    if (open) setFocusIdx(Math.max(0, options.indexOf(current)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current]);

  // Focus the highlighted button when focusIdx changes.
  useEffect(() => {
    if (!open) return;
    const items = ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[focusIdx]?.focus();
  }, [focusIdx, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => (i + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => (i - 1 + options.length) % options.length);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPick(options[focusIdx]);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, onPick, focusIdx, options]);

  if (!open || !anchorRect || typeof document === "undefined") return null;

  const menuHeight = 116;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUp = spaceBelow < menuHeight + 8;
  const top    = openUp ? Math.max(8, anchorRect.top - menuHeight - 4) : anchorRect.bottom + 4;
  const right  = Math.max(8, window.innerWidth - anchorRect.right);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Change posting status"
      className="fixed z-[60] w-44 overflow-hidden rounded-lg border border-border/60 bg-popover shadow-xl shadow-black/20"
      style={{ top, right }}
    >
      {options.map((s, idx) => {
        const m = STATUS_META[s];
        const active = s === current;
        return (
          <button
            key={s}
            type="button"
            role="menuitem"
            tabIndex={idx === focusIdx ? 0 : -1}
            onClick={(e) => { e.stopPropagation(); onPick(s); }}
            onMouseEnter={() => setFocusIdx(idx)}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none",
              active && "bg-accent/50",
            )}
          >
            <span className={cn("flex h-5 w-5 items-center justify-center", m.iconTint)}>
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

export const BundleCard = memo(BundleCardImpl);
