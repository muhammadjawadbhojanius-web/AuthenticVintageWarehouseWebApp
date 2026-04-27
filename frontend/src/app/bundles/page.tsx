"use client";

import * as React from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, X, Inbox, RefreshCw, Video, Download, Search, Trash2, Share, CheckCircle2, ThumbsUp, ThumbsDown, CheckSquare, SlidersHorizontal, ClipboardList } from "lucide-react";
import { createPortal } from "react-dom";
import { AppHeader } from "@/components/app-header";
import { BundleCard } from "@/components/bundle-card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { BundleListSkeleton } from "@/components/skeletons";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { BulkByListDialog } from "@/components/bulk-by-list-dialog";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useAuth } from "@/contexts/auth-context";
import { useUploadQueue } from "@/contexts/upload-queue-context";
import { useToast } from "@/components/toaster";
import { fetchBundles, deleteBundle as apiDeleteBundle, updateBundlePosted, fetchApprovedBrands, fetchApprovedArticles } from "@/lib/queries";
import { fetchClipboardTemplate, copyBundleToClipboard } from "@/lib/clipboard-template";
import { isVideoFilename, mediaUrlFor } from "@/lib/media";
import { detectDevice, nativeDownload, shareFile } from "@/lib/download";
import { prefetchBundleMedia, type PrefetchedMedia } from "@/lib/bundle-prefetch";
import { cn } from "@/lib/utils";
import type { Bundle, BundleImage } from "@/lib/types";

// ---------------------------------------------------------------------------
// Filter popover.
//
// Trigger is a compact button with an active-filter-count badge. Click
// opens a portal-positioned panel (same positioning strategy as the
// Status dropdown on bundle cards) with segmented button groups for
// each filter. Matches the Settings page's appearance/theme toggle so
// it feels native to the app.
// ---------------------------------------------------------------------------

interface FilterOption {
  value: string | number;
  label: string;
}

interface FilterGroup {
  label: string;
  options: FilterOption[];
  value: string | number;
  onChange: (v: string | number) => void;
}

function FilterSegmentedGroup({ label, options, value, onChange }: FilterGroup) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        }}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input hover:bg-accent",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface FilterPanelProps {
  anchorRect: DOMRect | null;
  groups: FilterGroup[];
  onClear: (() => void) | null;
  onClose: () => void;
}

function FilterPanel({ anchorRect, groups, onClear, onClose }: FilterPanelProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
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
  }, [onClose]);

  if (!anchorRect || typeof document === "undefined") return null;

  // Panel roughly ~300 px tall (3 groups); flip upward when there isn't room below.
  const estimatedHeight = 300;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUp = spaceBelow < estimatedHeight + 8;
  const top = openUp
    ? Math.max(8, anchorRect.top - estimatedHeight - 4)
    : anchorRect.bottom + 4;
  // Right-anchor so the panel doesn't overflow the right edge on phones.
  const right = Math.max(8, window.innerWidth - anchorRect.right);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Filters"
      className="fixed z-[60] w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-lg border bg-background shadow-lg"
      style={{ top, right }}
    >
      <div className="space-y-3 p-3">
        {groups.map((g) => (
          <FilterSegmentedGroup key={g.label} {...g} />
        ))}
        {onClear && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function BundlesPage() {
  const { ready } = useAuthGuard();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const { toast } = useToast();

  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloadFor, setDownloadFor] = useState<Bundle | null>(null);
  // iOS-only — pre-fetched blobs keyed by BundleImage.id
  const [prefetched, setPrefetched] = useState<Record<number, PrefetchedMedia>>({});
  const [preparingCode, setPreparingCode] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  // Synchronous guard so a rapid double-tap on the same file's Save /
  // Download button can't fire two downloads + two toasts before React
  // re-renders the row with its "Saved" / "Downloaded" state.
  const busyIdsRef = useRef<Set<number>>(new Set());
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  // Backward status-change confirmation (any move that lowers the rank —
  // Sold → Posted, Sold → Draft, Posted → Draft). Forward moves fire
  // immediately without a dialog.
  const [pendingStatus, setPendingStatus] = useState<{
    bundle: Bundle;
    next: number;
  } | null>(null);
  // Unified bulk-action confirm. Every bulk action — delete, and every
  // status target — opens this dialog, which lists the exact bundle
  // codes being operated on so the user can double-check before
  // committing. The per-card flow is separate; this is only for the
  // selection bar.
  const [bulkConfirm, setBulkConfirm] = useState<
    | { kind: "delete" }
    | { kind: "status"; target: 0 | 1 | 2 }
    | null
  >(null);
  const bulkActionRef = useRef(false);
  // "Bulk Action By List" entry point. Pasted codes are validated against
  // the DB inside the dialog; on submit we feed selected + bulkConfirm so
  // the existing confirm/execution path runs unchanged.
  const [bulkByListOpen, setBulkByListOpen] = useState(false);
  const uploadQueue = useUploadQueue();
  const device = useMemo(() => detectDevice(), []);
  const isIOS = device === "ios";

  // Bundle codes that currently have a queued or running upload task.
  const uploadingCodes = useMemo(() => {
    const s = new Set<string>();
    for (const t of uploadQueue.tasks) {
      if (t.status === "queued" || t.status === "running") {
        s.add(t.bundleCode);
      }
    }
    return s;
  }, [uploadQueue.tasks]);
  const [copyingCode, setCopyingCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Filter state. Feature-flagged to developers for now; the values
  // still flow through the query even when the filter bar is hidden
  // so the behaviour is identical across roles.
  type StatusFilter = "all" | 0 | 1 | 2;
  type PrefixFilter = "all" | "AV" | "AVG";
  type MediaFilter = "all" | "with" | "without";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [prefixFilter, setPrefixFilter] = useState<PrefixFilter>("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  // Popover open/close + anchor rect for portal positioning.
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterRect, setFilterRect] = useState<DOMRect | null>(null);
  const filterBtnRef = useRef<HTMLButtonElement | null>(null);
  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) +
    (prefixFilter !== "all" ? 1 : 0) +
    (mediaFilter !== "all" ? 1 : 0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const isAdmin = role === "Admin";
  const isListingExec = role === "Listing Executives";
  const isContentCreator = role === "Content Creators";
  const canDownload = isAdmin || isListingExec;
  // Posted / Draft / Sold is Admin + Listing Executive. Content
  // Creators build bundles but don't manage their posting lifecycle.
  const canManagePosting = isAdmin || isListingExec;
  // Only Admins and Content Creators can create new bundles. Listing
  // Executives have a read-only + posting-toggle view.
  const canCreateBundle = isAdmin || isContentCreator;

  const bundlesQuery = useQuery({
    queryKey: ["bundles", debouncedSearch, statusFilter, prefixFilter, mediaFilter],
    queryFn: () =>
      fetchBundles({
        search: debouncedSearch || undefined,
        posted: statusFilter === "all" ? undefined : statusFilter,
        prefix: prefixFilter === "all" ? undefined : prefixFilter,
        has_media:
          mediaFilter === "with" ? true : mediaFilter === "without" ? false : undefined,
      }),
    enabled: ready,
  });

  const approvedBrandsQuery = useQuery({
    queryKey: ["catalog", "brands"],
    queryFn: fetchApprovedBrands,
    staleTime: 60_000,
    enabled: ready,
  });
  const approvedArticlesQuery = useQuery({
    queryKey: ["catalog", "articles"],
    queryFn: fetchApprovedArticles,
    staleTime: 60_000,
    enabled: ready,
  });
  const approvedBrandNames = useMemo(
    () => new Set((approvedBrandsQuery.data ?? []).map((b) => b.name.toLowerCase())),
    [approvedBrandsQuery.data],
  );
  const approvedArticleNames = useMemo(
    () => new Set((approvedArticlesQuery.data ?? []).map((a) => a.name.toLowerCase())),
    [approvedArticlesQuery.data],
  );

  const deleteMutation = useMutation({
    mutationFn: (code: string) => apiDeleteBundle(code),
    onSuccess: (_, code) => {
      toast({ title: `Bundle ${code} deleted`, variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["bundles"] });
    },
    onError: () => {
      toast({ title: "Failed to delete bundle", variant: "error" });
    },
  });

  const statusLabel = (n: number) =>
    n === 2 ? "sold" : n === 1 ? "posted" : "draft";

  const postedMutation = useMutation({
    mutationFn: (v: { code: string; posted: number }) =>
      updateBundlePosted(v.code, v.posted),
    onSuccess: (_, v) => {
      toast({
        title: `${v.code} marked ${statusLabel(v.posted)}`,
        variant: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["bundles"] });
    },
    onError: () => {
      toast({ title: "Failed to update posting state", variant: "error" });
    },
  });

  const templateQuery = useQuery({
    queryKey: ["clipboard-template"],
    queryFn: fetchClipboardTemplate,
    enabled: ready,
  });

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  /**
   * User picked a status from the per-card dropdown. Rank: 0 draft <
   * 1 posted < 2 sold. Forward moves (rank goes up) fire immediately;
   * backward moves open a confirm dialog so the Listing Exec doesn't
   * accidentally undo a sale or un-post a live item.
   */
  const handleChangeStatus = (bundle: Bundle, next: number) => {
    const current = bundle.posted ?? 0;
    if (next === current) return;
    if (next < current) {
      setPendingStatus({ bundle, next });
      return;
    }
    postedMutation.mutate({ code: bundle.bundle_code, posted: next });
  };

  const toggleSelected = (code: string, next: boolean) => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (next) s.add(code);
      else s.delete(code);
      if (s.size === 0) setSelectionMode(false);
      return s;
    });
  };

  const handleCopy = async (bundle: Bundle) => {
    setCopyingCode(bundle.bundle_code);
    try {
      await copyBundleToClipboard(bundle, templateQuery.data);
      toast({ title: `Copied ${bundle.bundle_code}`, variant: "success" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Copy failed", description: msg, variant: "error" });
    } finally {
      setCopyingCode(null);
    }
  };

  const handleOpenDownload = async (bundle: Bundle) => {
    if (preparingCode) return;
    if (!bundle.images || bundle.images.length === 0) {
      toast({ title: "No media in this bundle", variant: "warning" });
      return;
    }

    if (!isIOS) {
      // Android + desktop: open the dialog immediately. Each per-file
      // Download tap triggers the browser's own download manager via a
      // direct URL, so there's nothing to pre-load here.
      setSavedIds(new Set());
      setDownloadFor(bundle);
      return;
    }

    // iOS: pre-fetch every file so the per-file Save tap can fire
    // navigator.share() synchronously inside a real user gesture.
    setPreparingCode(bundle.bundle_code);
    prefetchAbortRef.current?.abort();
    const ac = new AbortController();
    prefetchAbortRef.current = ac;
    try {
      const got = await prefetchBundleMedia(bundle.images, { signal: ac.signal });
      if (ac.signal.aborted) return;
      const map: Record<number, PrefetchedMedia> = {};
      for (const m of got) map[m.image.id] = m;
      setPrefetched(map);
      setSavedIds(new Set());
      setDownloadFor(bundle);
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        toast({ title: "Failed to prepare media for download", variant: "error" });
      }
    } finally {
      if (prefetchAbortRef.current === ac) prefetchAbortRef.current = null;
      setPreparingCode((c) => (c === bundle.bundle_code ? null : c));
    }
  };

  const handleCloseDownload = () => {
    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = null;
    busyIdsRef.current.clear();
    setDownloadFor(null);
    setPrefetched({});
    setSavedIds(new Set());
  };

  /**
   * Android + desktop download: hand the direct URL to the browser so
   * its own download manager streams it. The backend serves this URL
   * with Content-Disposition: attachment so it won't render inline.
   * On Android the file lands in /Download and MediaStore indexes it,
   * which makes it appear in the Gallery / Google Photos app.
   */
  const handleNativeDownload = (img: BundleImage) => {
    if (busyIdsRef.current.has(img.id)) return;
    busyIdsRef.current.add(img.id);
    const fileName = img.image_path.split("/").pop() || "file";
    const url = `${mediaUrlFor(img.image_path)}?download=true`;
    nativeDownload(url, fileName);
    setSavedIds((prev) => new Set(prev).add(img.id));
    toast({ title: `Downloading ${fileName}`, variant: "success" });
  };

  /**
   * iOS save: call navigator.share() with the pre-fetched blob so the
   * native share sheet offers "Save Image" / "Save Video" (the only
   * reliable way into Photos on iOS). Cancellation leaves the button
   * intact so the user can try again.
   */
  const handleShareOne = async (img: BundleImage) => {
    if (busyIdsRef.current.has(img.id)) return;
    busyIdsRef.current.add(img.id);
    try {
      const entry = prefetched[img.id];
      if (!entry) return;
      const outcome = await shareFile(entry.file);
      if (outcome === "shared") {
        setSavedIds((prev) => new Set(prev).add(img.id));
        return;
      }
      if (outcome === "cancelled") {
        // User backed out — clear the guard so they can try again.
        busyIdsRef.current.delete(img.id);
        return;
      }
      // "unsupported" — very old iOS. Fall back to the direct server URL.
      const url = `${mediaUrlFor(img.image_path)}?download=true`;
      nativeDownload(url, entry.fileName);
      setSavedIds((prev) => new Set(prev).add(img.id));
      toast({
        title: "Saved to Files",
        description: "Your iOS doesn't support Save to Photos — file is in Files.",
        variant: "warning",
      });
    } catch {
      // Anything unexpected — release the guard so the user can retry.
      busyIdsRef.current.delete(img.id);
    }
  };

  // Defensive: the query layer already rejects non-array responses, but
  // in case something slips through (persisted cache, mid-rollout build)
  // we still want .map to be safe.
  const bundles = Array.isArray(bundlesQuery.data) ? bundlesQuery.data : [];

  const showSelectionBar = selectionMode && (isAdmin || canManagePosting);
  const selectableCodes = bundles.map((b) => b.bundle_code);
  const allSelected =
    selectableCodes.length > 0 && selected.size === selectableCodes.length;
  const noneSelected = selected.size === 0;
  const handleSelectAll = () => {
    if (allSelected) {
      // Clear without dropping out of selection mode — the X button is
      // the explicit "exit" path.
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableCodes));
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* In selection mode the action bar *replaces* the app header and
          takes its sticky slot — so the Delete / Post / etc. buttons
          remain reachable no matter how far the user has scrolled. */}
      {!showSelectionBar && <AppHeader showAdmin />}

      {showSelectionBar && (
        <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b bg-background/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectionMode(false);
                setSelected(new Set());
              }}
              aria-label="Exit selection"
            >
              <X className="h-5 w-5" />
            </Button>
            {/* Master checkbox — select / deselect every currently-
                visible bundle (search + filters are respected). */}
            <button
              type="button"
              onClick={handleSelectAll}
              aria-label={allSelected ? "Deselect all" : "Select all"}
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-primary shadow-sm transition-colors",
                allSelected
                  ? "bg-primary text-primary-foreground"
                  : noneSelected
                    ? "bg-background"
                    // Indeterminate — some but not all selected.
                    : "bg-primary/60 text-primary-foreground",
              )}
            >
              {allSelected ? (
                <CheckSquare className="h-4 w-4" />
              ) : !noneSelected ? (
                // Indeterminate glyph — a small dash.
                <span className="block h-0.5 w-2.5 rounded-full bg-current" />
              ) : null}
            </button>
            <span className="text-sm font-medium">
              {selected.size}
              {bundles.length > 0 && (
                <span className="text-muted-foreground"> / {bundles.length}</span>
              )}{" "}
              selected
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* "By List" entry — opens a paste-codes dialog; doesn't depend
                on the current selection. Visible whenever the bar is. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkByListOpen(true)}
              aria-label="Bulk action by list"
              title="Paste a list of bundle codes"
            >
              <ClipboardList className="h-4 w-4" />
              By List
            </Button>
            {canManagePosting && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setBulkConfirm({ kind: "status", target: 0 })}
                  aria-label="Mark selected as draft"
                >
                  <ThumbsDown className="h-4 w-4" />
                  Draft
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setBulkConfirm({ kind: "status", target: 1 })}
                  aria-label="Mark selected posted"
                >
                  <ThumbsUp className="h-4 w-4" />
                  Posted
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setBulkConfirm({ kind: "status", target: 2 })}
                  aria-label="Mark selected sold"
                >
                  <span className="text-base leading-none" aria-hidden>💵</span>
                  Sold
                </Button>
              </>
            )}
            {isAdmin && (
              <Button
                variant="destructive"
                size="sm"
                disabled={selected.size === 0}
                onClick={() => setBulkConfirm({ kind: "delete" })}
                aria-label="Delete selected bundles"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {/* Search Bar & Refresh */}
        <div className="mx-auto mb-4 max-w-2xl flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by ID, name, article or brand..."
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {/* Desktop-friendly entry to bulk selection. Long-press still
              works on mobile / right-click still works on desktop — this
              button is the discoverable path, visible to anyone who has
              at least one bulk action available. */}
          {(isAdmin || canManagePosting) && (
            <Button
              variant={selectionMode ? "default" : "outline"}
              size="icon"
              onClick={() => {
                if (selectionMode) {
                  setSelectionMode(false);
                  setSelected(new Set());
                } else {
                  setSelectionMode(true);
                }
              }}
              title={selectionMode ? "Cancel selection" : "Select bundles"}
              aria-label={
                selectionMode ? "Cancel selection" : "Select bundles"
              }
            >
              {selectionMode ? (
                <X className="h-4 w-4" />
              ) : (
                <CheckSquare className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            ref={filterBtnRef}
            variant={activeFilterCount > 0 || filterOpen ? "default" : "outline"}
            size="icon"
            onClick={() => {
              if (!filterOpen && filterBtnRef.current) {
                setFilterRect(filterBtnRef.current.getBoundingClientRect());
              }
              setFilterOpen((v) => !v);
            }}
            title={
              activeFilterCount > 0
                ? `Filters (${activeFilterCount} active)`
                : "Filters"
            }
            aria-label="Toggle filters"
            aria-expanded={filterOpen}
            className="relative"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => bundlesQuery.refetch()}
            disabled={bundlesQuery.isFetching}
            title="Refresh list"
          >
            <RefreshCw className={cn("h-4 w-4", bundlesQuery.isFetching && "animate-spin")} />
          </Button>
        </div>

        {/* Filter popover — portal-mounted so it isn't clipped by any
            scroll container. Available to every role. */}
        {filterOpen && (
          <FilterPanel
            anchorRect={filterRect}
            groups={[
              {
                label: "Status",
                value: statusFilter,
                onChange: (v) => setStatusFilter(v as StatusFilter),
                options: [
                  { value: "all", label: "All" },
                  { value: 0, label: "Draft" },
                  { value: 1, label: "Posted" },
                  { value: 2, label: "Sold" },
                ],
              },
              {
                label: "Prefix",
                value: prefixFilter,
                onChange: (v) => setPrefixFilter(v as PrefixFilter),
                options: [
                  { value: "all", label: "All" },
                  { value: "AV", label: "AV-" },
                  { value: "AVG", label: "AVG-" },
                ],
              },
              {
                label: "Media",
                value: mediaFilter,
                onChange: (v) => setMediaFilter(v as MediaFilter),
                options: [
                  { value: "all", label: "All" },
                  { value: "with", label: "With" },
                  { value: "without", label: "Without" },
                ],
              },
            ]}
            onClear={
              activeFilterCount > 0
                ? () => {
                    setStatusFilter("all");
                    setPrefixFilter("all");
                    setMediaFilter("all");
                  }
                : null
            }
            onClose={() => setFilterOpen(false)}
          />
        )}

        {bundlesQuery.isLoading && <BundleListSkeleton count={6} />}
        {bundlesQuery.isError && (
          <Card className="mx-auto max-w-md p-6 text-center">
            <p className="font-semibold">Could not load bundles.</p>
            <p className="mt-1 text-sm text-muted-foreground">Check the server address in Settings.</p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["bundles"] })}
            >
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </Card>
        )}
        {bundlesQuery.isSuccess && bundles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="h-12 w-12" />
            <p className="mt-3 font-medium">
              {search ? "No matches found" : "No bundles yet"}
            </p>
            <p className="text-sm">
              {search ? "Try a different search term." : "Tap the + button to add one."}
            </p>
          </div>
        )}
        {bundles.length > 0 && (
          <div className="mx-auto max-w-2xl space-y-2">
            {bundles.map((b) => {
              const code = b.bundle_code;
              const hasPendingCatalog = (b.items ?? []).some(
                (item) =>
                  (item.brand && !approvedBrandNames.has(item.brand.toLowerCase())) ||
                  (item.article && !approvedArticleNames.has(item.article.toLowerCase())),
              );
              return (
                <BundleCard
                  key={code}
                  bundle={b}
                  hasPendingCatalog={hasPendingCatalog}
                  selectionMode={selectionMode}
                  selected={selected.has(code)}
                  canDownload={canDownload}
                  canDelete={isAdmin}
                  copying={copyingCode === code}
                  isUploading={uploadingCodes.has(code)}
                  preparingDownload={preparingCode === code}
                  onLongPress={
                    // Anyone with at least one available bulk action can
                    // enter selection mode: Admin → bulk delete;
                    // Developer → bulk post / draft (and bulk delete when
                    // they're acting as Admin).
                    isAdmin || canManagePosting
                      ? () => {
                          setSelectionMode(true);
                          setSelected(new Set([code]));
                        }
                      : undefined
                  }
                  onSelectionChange={(v) => toggleSelected(code, v)}
                  onClick={() => router.push(`/bundles/${encodeURIComponent(code)}`)}
                  onDownload={() => handleOpenDownload(b)}
                  onDelete={() => setDeleteFor(code)}
                  onCopy={() => handleCopy(b)}
                  canManagePosting={canManagePosting}
                  onChangeStatus={(next) => handleChangeStatus(b, next)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* FAB — hidden for Listing Executives (they only view + post). */}
      {canCreateBundle && (
        <button
          onClick={() => router.push("/bundles/new")}
          className="fixed bottom-12 right-6 z-10 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-primary-foreground shadow-lg transition-transform hover:scale-105"
        >
          <Plus className="h-5 w-5" /> Add Bundle
        </button>
      )}

      {/* Download dialog */}
      <Dialog open={!!downloadFor} onOpenChange={(v) => !v && handleCloseDownload()}>
        <DialogContent onClose={handleCloseDownload}>
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Media in</span>
              <span className="font-mono text-base tracking-tight">
                {downloadFor?.bundle_code}
              </span>
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {downloadFor?.images.length ?? 0}
              {(downloadFor?.images.length ?? 0) === 1 ? " file" : " files"}
              {" · "}
              {isIOS ? "Tap Save to add to Photos" : "Tap Download to save to your gallery"}
            </p>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {downloadFor?.images.map((img) => {
              const fileName = img.image_path.split("/").pop() || "file";
              const isVid = isVideoFilename(fileName);
              const saved = savedIds.has(img.id);
              const ready = isIOS ? !!prefetched[img.id] : true;
              const url = mediaUrlFor(img.image_path);
              return (
                <div
                  key={img.id}
                  className="flex items-center gap-3 rounded-lg border bg-card p-2 transition-colors hover:border-foreground/20"
                >
                  {/* Thumbnail — mirrors the bundle-card style */}
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                    {isVid ? (
                      <>
                        <video
                          src={`${url}#t=0.1`}
                          preload="metadata"
                          muted
                          playsInline
                          className="h-full w-full object-cover"
                        />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15">
                          <Video className="h-4 w-4 text-white drop-shadow" />
                        </div>
                      </>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt=""
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>

                  {/* File label */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-semibold tracking-tight">
                      {fileName}
                    </p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {isVid ? "VIDEO" : "PHOTO"}
                    </p>
                  </div>

                  {/* Action — matches the card's terracotta tone */}
                  {saved ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-success/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {isIOS ? "Saved" : "Done"}
                    </span>
                  ) : isIOS ? (
                    <button
                      type="button"
                      disabled={!ready}
                      onClick={() => handleShareOne(img)}
                      aria-label="Save to Photos"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold text-orange-700 transition-colors hover:bg-orange-500/10 disabled:opacity-60 dark:text-orange-400 dark:hover:bg-orange-400/10"
                    >
                      <Share className="h-4 w-4" />
                      Save
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleNativeDownload(img)}
                      aria-label="Download file"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold text-orange-700 transition-colors hover:bg-orange-500/10 dark:text-orange-400 dark:hover:bg-orange-400/10"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDownload}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteFor} onOpenChange={(v) => !v && setDeleteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete bundle?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{deleteFor}</strong> and all its media.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFor(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteFor) deleteMutation.mutate(deleteFor);
                setDeleteFor(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unified bulk-action confirm. Every bulk action routes through
          this — Delete, and each status target (Draft / Posted / Sold).
          Lists the exact bundle codes being operated on so the user
          can double-check before committing. */}
      <Dialog
        open={!!bulkConfirm}
        onOpenChange={(v) => !v && !bulkActionRef.current && setBulkConfirm(null)}
      >
        <DialogContent
          onClose={
            bulkActionRef.current ? undefined : () => setBulkConfirm(null)
          }
        >
          <DialogHeader>
            <DialogTitle>
              {bulkConfirm?.kind === "delete"
                ? `Delete ${selected.size} bundle${selected.size === 1 ? "" : "s"}?`
                : bulkConfirm?.kind === "status"
                  ? `Mark ${selected.size} bundle${selected.size === 1 ? "" : "s"} as ${statusLabel(bulkConfirm.target)}?`
                  : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {bulkConfirm?.kind === "delete"
                ? "This permanently deletes every bundle below along with its items and media. Cannot be undone."
                : bulkConfirm?.kind === "status"
                  ? bulkConfirm.target === 2
                    ? "Every bundle below will be marked sold."
                    : bulkConfirm.target === 1
                      ? "Every bundle below will be marked posted. Bundles already sold will revert to posted."
                      : "Every bundle below will revert to draft. Bundles already at a higher status will move down."
                  : ""}
            </p>
            {/* Bundle code list — scrollable so large selections still
                fit on a phone screen without stretching the dialog. */}
            <div className="max-h-[40vh] overflow-y-auto rounded-md border bg-muted/20 p-2">
              <div className="flex flex-wrap gap-1.5">
                {Array.from(selected)
                  .sort()
                  .map((code) => (
                    <span
                      key={code}
                      className="inline-flex items-center rounded-md border bg-card px-2 py-0.5 font-mono text-xs font-semibold"
                    >
                      {code}
                    </span>
                  ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkConfirm(null)}
              disabled={bulkActionRef.current}
            >
              Cancel
            </Button>
            <Button
              variant={bulkConfirm?.kind === "delete" ? "destructive" : "default"}
              disabled={bulkActionRef.current}
              onClick={async () => {
                if (!bulkConfirm) return;
                if (bulkActionRef.current) return;
                bulkActionRef.current = true;
                const action = bulkConfirm;
                const codes = Array.from(selected);
                setBulkConfirm(null);
                setSelectionMode(false);
                setSelected(new Set());
                try {
                  const results = await Promise.allSettled(
                    codes.map((c) =>
                      action.kind === "delete"
                        ? apiDeleteBundle(c)
                        : updateBundlePosted(c, action.target),
                    ),
                  );
                  const failed = results.filter((r) => r.status === "rejected").length;
                  queryClient.invalidateQueries({ queryKey: ["bundles"] });
                  const verb =
                    action.kind === "delete"
                      ? "Deleted"
                      : `Marked as ${statusLabel(action.target)}`;
                  if (failed === 0) {
                    toast({
                      title: `${verb} ${codes.length} bundle${codes.length === 1 ? "" : "s"}`,
                      variant: "success",
                    });
                  } else {
                    toast({
                      title: `${verb} ${codes.length - failed} of ${codes.length}`,
                      description: `${failed} failed`,
                      variant: "warning",
                    });
                  }
                } finally {
                  bulkActionRef.current = false;
                }
              }}
            >
              {bulkConfirm?.kind === "delete"
                ? `Delete ${selected.size}`
                : bulkConfirm?.kind === "status"
                  ? `Mark as ${statusLabel(bulkConfirm.target)}`
                  : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* "Bulk Action By List" entry point. The dialog validates pasted
          codes against the DB and only emits a non-empty all-valid set,
          which we hand straight to the existing bulk-confirm flow above. */}
      <BulkByListDialog
        open={bulkByListOpen}
        onOpenChange={setBulkByListOpen}
        canDelete={isAdmin}
        onSubmit={(codes, action) => {
          setSelected(new Set(codes));
          setBulkConfirm(action);
          setBulkByListOpen(false);
        }}
      />

      {/* Single backward status-change confirm. Fires only when the
          user picks a lower rank from the dropdown (Sold → Posted,
          Sold → Draft, Posted → Draft). Forward moves are unprompted. */}
      <Dialog
        open={!!pendingStatus}
        onOpenChange={(v) => !v && setPendingStatus(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark as {pendingStatus ? statusLabel(pendingStatus.next) : ""}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <strong>{pendingStatus?.bundle.bundle_code}</strong> is currently{" "}
            <span className="font-medium">
              {pendingStatus ? statusLabel(pendingStatus.bundle.posted ?? 0) : ""}
            </span>
            . Are you sure you want to move it back to{" "}
            <span className="font-medium">
              {pendingStatus ? statusLabel(pendingStatus.next) : ""}
            </span>
            ?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingStatus(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingStatus) {
                  postedMutation.mutate({
                    code: pendingStatus.bundle.bundle_code,
                    posted: pendingStatus.next,
                  });
                }
                setPendingStatus(null);
              }}
            >
              Mark as {pendingStatus ? statusLabel(pendingStatus.next) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
