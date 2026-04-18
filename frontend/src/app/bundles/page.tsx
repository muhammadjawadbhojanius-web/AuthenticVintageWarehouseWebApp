"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, X, Inbox, RefreshCw, Video, Download, Search, Trash2, Share, CheckCircle2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BundleCard } from "@/components/bundle-card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useAuth } from "@/contexts/auth-context";
import { useUploadQueue } from "@/contexts/upload-queue-context";
import { useToast } from "@/components/toaster";
import { fetchBundles, deleteBundle as apiDeleteBundle } from "@/lib/queries";
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
  // Same pattern for the bulk-delete button — the Dialog's OK button can
  // get a second synthetic tap on mobile before it unmounts.
  const bulkDeletingRef = useRef(false);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
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
  const canDownload = isAdmin || role === "Listing Executives";

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

  const bundles = bundlesQuery.data ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader showAdmin />

      {/* Selection-mode action bar — admin-only, bulk delete is the only
          bulk action. There is no bulk download path (individual downloads
          only) so selection mode is gated off for non-admin roles at the
          card's onLongPress. */}
      {selectionMode && isAdmin && (
        <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
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

        {bundlesQuery.isLoading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}
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
                    isAdmin
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

    </div>
  );
}
