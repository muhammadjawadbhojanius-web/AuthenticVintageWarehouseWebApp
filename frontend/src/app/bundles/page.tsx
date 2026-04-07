"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, X, DownloadCloud, Inbox, RefreshCw, Image as ImageIcon, Video, Download } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { ConnectivityRibbon } from "@/components/connectivity-ribbon";
import { BundleCard } from "@/components/bundle-card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { IOSSaveSheet } from "@/components/ios-save-sheet";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/toaster";
import { fetchBundles, fetchBundle, deleteBundle as apiDeleteBundle } from "@/lib/queries";
import { mediaUrlFor, isVideoFilename } from "@/lib/media";
import { isIOSSafari, fetchAsFile, anchorDownload } from "@/lib/ios-download";
import { copyBundleToClipboard } from "@/lib/clipboard-template";
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
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [iosSheet, setIosSheet] = useState<{ url: string; fileName: string } | null>(null);
  const [copyingCode, setCopyingCode] = useState<string | null>(null);

  const isAdmin = role === "Admin";
  const canDownload = isAdmin || role === "Listing Executives";

  const bundlesQuery = useQuery({
    queryKey: ["bundles"],
    queryFn: fetchBundles,
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
      await copyBundleToClipboard(bundle);
      toast({ title: `Copied ${bundle.bundle_code}`, variant: "success" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Copy failed", description: msg, variant: "error" });
    } finally {
      setCopyingCode(null);
    }
  };

  const handleOpenDownload = async (code: string) => {
    try {
      const data = await fetchBundle(code);
      if (!data.images || data.images.length === 0) {
        toast({ title: "No media in this bundle", variant: "warning" });
        return;
      }
      setDownloadFor(data);
    } catch {
      toast({ title: "Failed to load bundle", variant: "error" });
    }
  };

  const handleSingleDownload = async (img: BundleImage) => {
    const fileName = img.image_path.split("/").pop() || "download";
    const url = `${mediaUrlFor(img.image_path)}?download=true`;
    toast({ title: "Starting download…" });

    if (isIOSSafari()) {
      setIosSheet({ url, fileName });
      return;
    }

    try {
      const file = await fetchAsFile(url, fileName);
      anchorDownload(file);
      toast({ title: `Downloaded ${fileName}`, variant: "success" });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    }
  };

  const bundles = bundlesQuery.data ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader showAdmin />

      {/* Selection-mode action bar */}
      {selectionMode && (
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
            <span className="text-sm font-medium">{selected.size} selected</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            disabled={selected.size === 0}
            onClick={async () => {
              const codes = Array.from(selected);
              setSelectionMode(false);
              setSelected(new Set());
              toast({ title: `Starting batch download for ${codes.length} bundles…` });
              let total = 0;
              let failed = 0;
              for (const code of codes) {
                try {
                  const data = await fetchBundle(code);
                  for (const img of data.images || []) {
                    await handleSingleDownload(img);
                    total++;
                  }
                } catch {
                  failed++;
                }
              }
              toast({
                title: `Batch finished — ${total} files`,
                description: failed > 0 ? `${failed} bundles failed` : undefined,
                variant: failed > 0 ? "warning" : "success",
              });
            }}
            aria-label="Batch download"
          >
            <DownloadCloud className="h-5 w-5" />
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
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
            <p className="mt-3 font-medium">No bundles yet</p>
            <p className="text-sm">Tap the + button to add one.</p>
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
                  onLongPress={() => {
                    setSelectionMode(true);
                    setSelected(new Set([code]));
                  }}
                  onSelectionChange={(v) => toggleSelected(code, v)}
                  onClick={() => {
                    if (selectionMode) {
                      toggleSelected(code, !selected.has(code));
                      return;
                    }
                    router.push(`/bundles/${encodeURIComponent(code)}`);
                  }}
                  onDownload={() => handleOpenDownload(code)}
                  onDelete={() => setDeleteFor(code)}
                  onCopy={() => handleCopy(b)}
                />
              );
            })}
          </div>
        )}
      </div>

      <ConnectivityRibbon />

      {/* FAB */}
      <button
        onClick={() => router.push("/bundles/new")}
        className="fixed bottom-12 right-6 z-10 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        <Plus className="h-5 w-5" /> Add Bundle
      </button>

      {/* Download dialog */}
      <Dialog open={!!downloadFor} onOpenChange={(v) => !v && setDownloadFor(null)}>
        <DialogContent onClose={() => setDownloadFor(null)}>
          <DialogHeader>
            <DialogTitle>Media in {downloadFor?.bundle_code}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {downloadFor?.images.map((img) => {
              const fileName = img.image_path.split("/").pop() || "file";
              const isVid = isVideoFilename(fileName);
              return (
                <div
                  key={img.id}
                  className="flex items-center gap-3 border-b py-2 last:border-b-0"
                >
                  {isVid ? (
                    <Video className="h-5 w-5 text-primary" />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-primary" />
                  )}
                  <span className="flex-1 truncate text-sm">{fileName}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleSingleDownload(img)}
                    aria-label="Download file"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDownloadFor(null)}>
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

      {/* iOS Save sheet */}
      {iosSheet && (
        <IOSSaveSheet
          open={!!iosSheet}
          url={iosSheet.url}
          fileName={iosSheet.fileName}
          onClose={() => setIosSheet(null)}
        />
      )}
    </div>
  );
}
