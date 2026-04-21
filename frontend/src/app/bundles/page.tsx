"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, X, Inbox, RefreshCw, Video, Download, Search, Trash2, Share, CheckCircle2, ThumbsUp, ThumbsDown } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BundleCard } from "@/components/bundle-card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { BundleListSkeleton } from "@/components/skeletons";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useAuth } from "@/contexts/auth-context";
import { useUploadQueue } from "@/contexts/upload-queue-context";
import { useToast } from "@/components/toaster";
import { fetchBundles, deleteBundle as apiDeleteBundle, updateBundlePosted } from "@/lib/queries";
import { fetchClipboardTemplate, copyBundleToClipboard } from "@/lib/clipboard-template";
import { isVideoFilename, mediaUrlFor } from "@/lib/media";
import { detectDevice, nativeDownload, shareFile } from "@/lib/download";
import { prefetchBundleMedia, type PrefetchedMedia } from "@/lib/bundle-prefetch";
import { cn } from "@/lib/utils";
import type { Bundle, BundleImage } from "@/lib/types";

export default function BundlesPage() {
  const { ready } = useAuthGuard();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { role, isDeveloper } = useAuth();
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
  // Same pattern for the bulk-delete button — the Dialog's OK button can
  // get a second synthetic tap on mobile before it unmounts.
  const bulkDeletingRef = useRef(false);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // Posted → Draft confirmation. Going the other direction is unprompted.
  const [unpostFor, setUnpostFor] = useState<Bundle | null>(null);
  // Bulk posted-toggle confirmation (only fires for Mark as Draft; bulk
  // Mark as Posted is unprompted).
  const [bulkUnpostOpen, setBulkUnpostOpen] = useState(false);
  const bulkUnpostingRef = useRef(false);
  const bulkPostingRef = useRef(false);
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

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const isAdmin = role === "Admin";
  const isListingExec = role === "Listing Executives";
  const canDownload = isAdmin || isListingExec;
  // Feature flag: Posted / Draft is a developer-only feature for now.
  // Gated on the real JWT role (isDeveloper), not the effective role —
  // that way a Developer still sees / uses it while impersonating any
  // other role to test. To open this to Admin + Listing Executives
  // later, switch this line to `isAdmin || isListingExec`.
  const canManagePosting = isDeveloper;

  const bundlesQuery = useQuery({
    queryKey: ["bundles", debouncedSearch],
    queryFn: () => fetchBundles(debouncedSearch),
    enabled: ready,
  });

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

  const postedMutation = useMutation({
    mutationFn: (v: { code: string; posted: boolean }) =>
      updateBundlePosted(v.code, v.posted),
    onSuccess: (_, v) => {
      toast({
        title: v.posted ? `${v.code} marked posted` : `${v.code} back to draft`,
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
   * Per-card posted pill click. Draft → Posted fires immediately;
   * Posted → Draft opens a confirm dialog (guarded in case someone taps
   * the pill by mistake on a bundle that's already live).
   */
  const handleTogglePosted = (bundle: Bundle) => {
    if (bundle.posted) {
      setUnpostFor(bundle);
      return;
    }
    postedMutation.mutate({ code: bundle.bundle_code, posted: true });
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

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader showAdmin />

      {/* Selection-mode action bar. Shown when the user has ≥1 bulk
          action available: Admin → Delete; Developer → Post / Draft
          (+ Delete when acting as Admin). */}
      {selectionMode && (isAdmin || canManagePosting) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectionMode(false);
                setSelected(new Set());
              }}
              aria-label="Cancel selection"
            >
              <X className="h-5 w-5" />
            </Button>
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManagePosting && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0 || postedMutation.isPending}
                  onClick={async () => {
                    // Bulk Mark Posted fires without a confirm — moving to
                    // posted is the safe direction.
                    if (bulkPostingRef.current) return;
                    bulkPostingRef.current = true;
                    const codes = Array.from(selected);
                    setSelectionMode(false);
                    setSelected(new Set());
                    try {
                      const results = await Promise.allSettled(
                        codes.map((c) => updateBundlePosted(c, true)),
                      );
                      const failed = results.filter((r) => r.status === "rejected").length;
                      queryClient.invalidateQueries({ queryKey: ["bundles"] });
                      if (failed === 0) {
                        toast({
                          title: `Marked ${codes.length} posted`,
                          variant: "success",
                        });
                      } else {
                        toast({
                          title: `Marked ${codes.length - failed} of ${codes.length} posted`,
                          description: `${failed} failed`,
                          variant: "warning",
                        });
                      }
                    } finally {
                      bulkPostingRef.current = false;
                    }
                  }}
                  aria-label="Mark selected posted"
                >
                  <ThumbsUp className="h-4 w-4" />
                  Post
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => setBulkUnpostOpen(true)}
                  aria-label="Mark selected as draft"
                >
                  <ThumbsDown className="h-4 w-4" />
                  Draft
                </Button>
              </>
            )}
            {isAdmin && (
              <Button
                variant="destructive"
                size="sm"
                disabled={selected.size === 0}
                onClick={() => setBulkDeleteOpen(true)}
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
              return (
                <BundleCard
                  key={code}
                  bundle={b}
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
                  onTogglePosted={() => handleTogglePosted(b)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => router.push("/bundles/new")}
        className="fixed bottom-12 right-6 z-10 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        <Plus className="h-5 w-5" /> Add Bundle
      </button>

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

      {/* Bulk delete confirm dialog (admin-only) */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selected.size} bundle{selected.size === 1 ? "" : "s"}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes every selected bundle and all of its media. Cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDeletingRef.current}
              onClick={async () => {
                // Ref guard — a fast double-tap on mobile can fire onClick
                // twice before the dialog unmounts. Without this we'd get
                // two "Deleting N bundles…" toasts and N extra DELETE
                // requests against already-gone rows.
                if (bulkDeletingRef.current) return;
                bulkDeletingRef.current = true;
                const codes = Array.from(selected);
                setBulkDeleteOpen(false);
                setSelectionMode(false);
                setSelected(new Set());
                // No intermediate "Deleting N bundles…" toast — on LAN the
                // deletions finish in ~1 s so that toast would still be on
                // screen when the result toast arrives, and the two would
                // stack up as if a duplicate pop-up had fired.
                try {
                  const results = await Promise.allSettled(codes.map((c) => apiDeleteBundle(c)));
                  const failed = results.filter((r) => r.status === "rejected").length;
                  queryClient.invalidateQueries({ queryKey: ["bundles"] });
                  if (failed === 0) {
                    toast({ title: `Deleted ${codes.length} bundle${codes.length === 1 ? "" : "s"}`, variant: "success" });
                  } else {
                    toast({
                      title: `Deleted ${codes.length - failed} of ${codes.length}`,
                      description: `${failed} failed`,
                      variant: "warning",
                    });
                  }
                } finally {
                  bulkDeletingRef.current = false;
                }
              }}
            >
              Delete {selected.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single posted → draft confirm. Only fires when going backwards;
          draft → posted is unprompted. */}
      <Dialog
        open={!!unpostFor}
        onOpenChange={(v) => !v && setUnpostFor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as draft?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <strong>{unpostFor?.bundle_code}</strong> is currently posted. Are you
            sure you want to revert it to draft?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnpostFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (unpostFor) {
                  postedMutation.mutate({
                    code: unpostFor.bundle_code,
                    posted: false,
                  });
                }
                setUnpostFor(null);
              }}
            >
              <ThumbsDown className="h-4 w-4" />
              Mark as draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk posted → draft confirm. Symmetric to the bulk-delete dialog —
          double-fire-guarded and clears selection on success. */}
      <Dialog open={bulkUnpostOpen} onOpenChange={setBulkUnpostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark {selected.size} bundle{selected.size === 1 ? "" : "s"} as draft?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Any of these that are currently posted will revert to draft. Bundles
            already in draft stay unchanged.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkUnpostOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={bulkUnpostingRef.current}
              onClick={async () => {
                if (bulkUnpostingRef.current) return;
                bulkUnpostingRef.current = true;
                const codes = Array.from(selected);
                setBulkUnpostOpen(false);
                setSelectionMode(false);
                setSelected(new Set());
                try {
                  const results = await Promise.allSettled(
                    codes.map((c) => updateBundlePosted(c, false)),
                  );
                  const failed = results.filter((r) => r.status === "rejected").length;
                  queryClient.invalidateQueries({ queryKey: ["bundles"] });
                  if (failed === 0) {
                    toast({
                      title: `Reverted ${codes.length} to draft`,
                      variant: "success",
                    });
                  } else {
                    toast({
                      title: `Reverted ${codes.length - failed} of ${codes.length}`,
                      description: `${failed} failed`,
                      variant: "warning",
                    });
                  }
                } finally {
                  bulkUnpostingRef.current = false;
                }
              }}
            >
              <ThumbsDown className="h-4 w-4" />
              Mark as draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
