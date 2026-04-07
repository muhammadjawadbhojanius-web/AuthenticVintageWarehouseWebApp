"use client";

import { memo, useState } from "react";
import { Package, Trash2, Download, ClipboardCopy, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Bundle } from "@/lib/types";

export interface BundleCardProps {
  bundle: Bundle;
  selected?: boolean;
  selectionMode?: boolean;
  isUploading?: boolean;
  copying?: boolean;
  onClick?: () => void;
  onLongPress?: () => void;
  onSelectionChange?: (next: boolean) => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  canDownload?: boolean;
  canDelete?: boolean;
}

function statusColor(status: string): "warning" | "success" | "default" | "secondary" {
  const s = status.toLowerCase();
  if (s === "pending" || s === "draft") return "warning";
  if (s === "uploaded" || s === "ready") return "success";
  if (s === "shipped") return "default";
  return "secondary";
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

function BundleCardImpl({
  bundle,
  selected = false,
  selectionMode = false,
  isUploading = false,
  copying = false,
  onClick,
  onLongPress,
  onSelectionChange,
  onDownload,
  onDelete,
  onCopy,
  canDownload = false,
  canDelete = false,
}: BundleCardProps) {
  const [pressTimer, setPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = () => {
    if (!onLongPress) return;
    const t = setTimeout(() => {
      onLongPress();
      setPressTimer(null);
    }, 600);
    setPressTimer(t);
  };
  const cancelLongPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      setPressTimer(null);
    }
  };

  return (
    <Card
      className={cn(
        "flex items-center gap-3 p-4 cursor-pointer transition-colors",
        selected && "border-primary bg-primary/5",
        !selected && "hover:bg-accent/50"
      )}
      onClick={onClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault();
          onLongPress();
        }
      }}
    >
      {selectionMode ? (
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onSelectionChange?.(v)}
        />
      ) : (
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            isUploading ? "bg-primary/15" : "bg-muted"
          )}
        >
          {isUploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <Package className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold">{bundle.bundle_code}</p>
          <Badge variant={statusColor(bundle.status)} className="text-[10px]">
            {isUploading ? "UPLOADING" : bundle.status.toUpperCase()}
          </Badge>
        </div>
        {bundle.bundle_name && (
          <p className="truncate text-sm italic text-muted-foreground">{bundle.bundle_name}</p>
        )}
        <p className="text-xs text-muted-foreground">{formatDate(bundle.created_at)}</p>
      </div>

      {!selectionMode && (
        <div className="flex items-center gap-1">
          {onCopy && (
            <Button
              variant="ghost"
              size="icon"
              disabled={copying}
              onClick={(e) => {
                e.stopPropagation();
                onCopy();
              }}
              aria-label="Copy bundle details"
            >
              {copying ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <ClipboardCopy className="h-5 w-5 text-primary" />
              )}
            </Button>
          )}
          {canDownload && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onDownload?.();
              }}
              aria-label="Download bundle"
            >
              <Download className="h-5 w-5 text-primary" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.();
              }}
              aria-label="Delete bundle"
            >
              <Trash2 className="h-5 w-5 text-destructive" />
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

// memo so the list page doesn't re-render every card on unrelated state
// changes (selection toggles, copy spinner, etc.). React's default
// shallow prop compare is enough — all props are stable callbacks or
// primitives.
export const BundleCard = memo(BundleCardImpl);
