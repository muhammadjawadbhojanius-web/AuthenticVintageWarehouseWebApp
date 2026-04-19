"use client";

import { useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2, Pencil, Plus, ClipboardCopy } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { BundleDetailSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { MediaThumb } from "@/components/media-thumb";
import { MediaPreviewOverlay, type PreviewItem } from "@/components/media-preview-overlay";
import {
  BundleItemForm,
  EMPTY_ITEM,
  validateItem,
  type BundleItemFormValues,
} from "@/components/bundle-item-form";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useToast } from "@/components/toaster";
import {
  fetchBundle,
  deleteBundleItem,
  deleteBundleImage,
  addBundleItem,
  updateBundleItem,
  updateBundle,
} from "@/lib/queries";
import { mediaUrlFor, isVideoFilename } from "@/lib/media";
import { mediaStatusLabel } from "@/lib/media-status";
import { useUploadQueue } from "@/contexts/upload-queue-context";
import { MediaPicker } from "@/components/media-picker";
import { fetchClipboardTemplate, copyBundleToClipboard } from "@/lib/clipboard-template";
import { useAuth } from "@/contexts/auth-context";
import type { BundleItem } from "@/lib/types";

export default function BundleDetailPage() {
  const { ready } = useAuthGuard();
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { role } = useAuth();
  const uploadQueue = useUploadQueue();
  const canEdit = role === "Admin" || role === "Content Creators";

  const [confirmItem, setConfirmItem] = useState<number | null>(null);
  const [confirmImage, setConfirmImage] = useState<number | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  // Edit-item dialog state
  const [editTarget, setEditTarget] = useState<BundleItem | null>(null);
  const [editDraft, setEditDraft] = useState<BundleItemFormValues>(EMPTY_ITEM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Add-item card state
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<BundleItemFormValues>(EMPTY_ITEM);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  // Edit-bundle dialog state
  const [editBundleOpen, setEditBundleOpen] = useState(false);
  const [editBundleCode, setEditBundleCode] = useState("");
  const [editBundleName, setEditBundleName] = useState("");
  const [editBundleError, setEditBundleError] = useState<string | null>(null);
  const [editBundleSaving, setEditBundleSaving] = useState(false);

  // Copy-to-clipboard state
  const [copying, setCopying] = useState(false);


  const bundleQuery = useQuery({
    queryKey: ["bundle", code],
    queryFn: () => fetchBundle(code),
    enabled: ready,
  });

  const templateQuery = useQuery({
    queryKey: ["clipboard-template"],
    queryFn: fetchClipboardTemplate,
    enabled: ready,
  });

  const images = useMemo(() => bundleQuery.data?.images ?? [], [bundleQuery.data]);
  const items = useMemo(() => bundleQuery.data?.items ?? [], [bundleQuery.data]);

  // Build preview items list (used by full-screen overlay)
  const previewItems: PreviewItem[] = useMemo(
    () =>
      images.map((img) => {
        const fileName = img.image_path.split("/").pop() || "";
        return {
          url: mediaUrlFor(img.image_path),
          isVideo: isVideoFilename(fileName),
          name: fileName,
        };
      }),
    [images]
  );

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const refreshBundle = () =>
    queryClient.invalidateQueries({ queryKey: ["bundle", code] });

  const handleCopy = async () => {
    if (!bundleQuery.data) return;
    setCopying(true);
    try {
      await copyBundleToClipboard(bundleQuery.data, templateQuery.data);
      toast({ title: "Bundle details copied", variant: "success" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Copy failed", description: msg, variant: "error" });
    } finally {
      setCopying(false);
    }
  };

  const openEditBundle = () => {
    if (!bundleQuery.data) return;
    setEditBundleCode(bundleQuery.data.bundle_code);
    setEditBundleName(bundleQuery.data.bundle_name ?? "");
    setEditBundleError(null);
    setEditBundleOpen(true);
  };

  const handleSaveBundle = async () => {
    if (!editBundleCode.trim()) {
      setEditBundleError("Bundle code is required.");
      return;
    }
    setEditBundleSaving(true);
    try {
      const payload: { bundle_code?: string; bundle_name?: string } = {};
      if (editBundleCode.trim().toUpperCase() !== code) {
        payload.bundle_code = editBundleCode.trim().toUpperCase();
      }
      const currentName = bundleQuery.data?.bundle_name ?? "";
      if (editBundleName.trim() !== currentName) {
        payload.bundle_name = editBundleName.trim();
      }
      if (Object.keys(payload).length === 0) {
        setEditBundleOpen(false);
        return;
      }
      await updateBundle(code, payload);
      toast({ title: "Bundle updated", variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["bundles"] });
      if (payload.bundle_code) {
        router.replace(`/bundles/${encodeURIComponent(payload.bundle_code)}`);
      } else {
        refreshBundle();
      }
      setEditBundleOpen(false);
    } catch {
      setEditBundleError("Failed to update bundle.");
    } finally {
      setEditBundleSaving(false);
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    try {
      await deleteBundleItem(code, itemId);
      toast({ title: "Item deleted", variant: "success" });
      refreshBundle();
    } catch {
      toast({ title: "Failed to delete item", variant: "error" });
    } finally {
      setConfirmItem(null);
    }
  };

  const handleDeleteImage = async (imageId: number) => {
    try {
      await deleteBundleImage(code, imageId);
      toast({ title: "Media deleted", variant: "success" });
      refreshBundle();
    } catch {
      toast({ title: "Failed to delete media", variant: "error" });
    } finally {
      setConfirmImage(null);
    }
  };

  const openEditItem = (it: BundleItem) => {
    setEditTarget(it);
    setEditDraft({
      gender: it.gender,
      brand: it.brand,
      article: it.article,
      number_of_pieces: it.number_of_pieces,
      gift_pcs: it.gift_pcs,
      grade: it.grade,
      size_variation: it.size_variation,
      comments: it.comments ?? "",
    });
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editTarget?.id) return;
    const err = validateItem(editDraft);
    if (err) {
      setEditError(err);
      return;
    }
    setEditSaving(true);
    try {
      await updateBundleItem(code, editTarget.id, {
        ...editDraft,
        comments: editDraft.comments || null,
      });
      toast({ title: "Item updated", variant: "success" });
      refreshBundle();
      setEditTarget(null);
    } catch {
      setEditError("Failed to save changes.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleAddItem = async () => {
    const err = validateItem(addDraft);
    if (err) {
      setAddError(err);
      return;
    }
    setAddSaving(true);
    try {
      await addBundleItem(code, {
        ...addDraft,
        comments: addDraft.comments || null,
      });
      toast({ title: "Item added", variant: "success" });
      refreshBundle();
      setAddDraft(EMPTY_ITEM);
      setAddOpen(false);
      setAddError(null);
    } catch {
      setAddError("Failed to add item.");
    } finally {
      setAddSaving(false);
    }
  };

  const handleAddFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    uploadQueue.enqueue({ bundleCode: code, files: Array.from(files) });
  };

  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="mx-auto max-w-3xl p-4">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">{code}</h1>
          {canEdit && bundleQuery.data && (
            <Button
              variant="ghost"
              size="icon"
              onClick={openEditBundle}
              aria-label="Edit bundle"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {bundleQuery.data && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={handleCopy}
                disabled={copying}
                aria-label="Copy bundle details"
              >
                {copying ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <ClipboardCopy className="h-4 w-4" />
                )}
                Copy
              </Button>
              {(() => {
                const uploading = uploadQueue.tasks.some(
                  (t) =>
                    t.bundleCode === code &&
                    (t.status === "queued" || t.status === "running"),
                );
                const hasMedia = (bundleQuery.data.images?.length ?? 0) > 0;
                return (
                  <Badge variant={uploading ? "warning" : hasMedia ? "success" : "secondary"}>
                    {uploading ? "Media in progress" : mediaStatusLabel(bundleQuery.data.images)}
                  </Badge>
                );
              })()}
            </>
          )}
        </div>

        {bundleQuery.isLoading && <BundleDetailSkeleton />}

        {bundleQuery.isSuccess && (
          <div className="space-y-4">
            {bundleQuery.data.bundle_name && (
              <p className="italic text-muted-foreground">{bundleQuery.data.bundle_name}</p>
            )}

            {/* Media grid */}
            <Card>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Media ({images.length})</h2>
                </div>

                {canEdit && (
                  <>
                    <MediaPicker
                      onFiles={(f) => handleAddFiles(f)}
                      size="sm"
                    />
                  </>
                )}

                {images.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No media.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {images.map((img, idx) => {
                      const fileName = img.image_path.split("/").pop() || "";
                      const isVid = isVideoFilename(fileName);
                      const url = mediaUrlFor(img.image_path);
                      return (
                        <MediaThumb
                          key={img.id}
                          url={url}
                          isVideo={isVid}
                          alt={fileName}
                          onClick={() => setPreviewIdx(idx)}
                          showRemove={canEdit}
                          onRemove={() => setConfirmImage(img.id)}
                        />
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Items list */}
            <Card>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Items ({items.length})</h2>
                  {canEdit && !addOpen && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAddOpen(true);
                        setAddDraft(EMPTY_ITEM);
                        setAddError(null);
                      }}
                    >
                      <Plus className="h-4 w-4" /> Add Item
                    </Button>
                  )}
                </div>
                {items.length === 0 && !addOpen ? (
                  <p className="text-sm text-muted-foreground">No items.</p>
                ) : (
                  items.map((it) => (
                    <div key={it.id} className="flex items-center gap-3 rounded-md border p-3">
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">
                          {it.brand} — {it.article}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {it.gender} · qty {it.number_of_pieces} · grade {it.grade} · sizes {it.size_variation}
                        </p>
                        {it.comments && (
                          <p className="mt-1 text-xs italic text-muted-foreground">{it.comments}</p>
                        )}
                      </div>
                      {canEdit && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditItem(it)}
                            aria-label="Edit item"
                          >
                            <Pencil className="h-4 w-4 text-primary" />
                          </Button>
                          {it.id != null && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setConfirmItem(it.id!)}
                              aria-label="Delete item"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  ))
                )}

                {addOpen && (
                  <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                    <BundleItemForm
                      value={addDraft}
                      onChange={setAddDraft}
                      disabled={addSaving}
                    />
                    {addError && (
                      <Alert variant="destructive">
                        <AlertDescription>{addError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setAddOpen(false);
                          setAddError(null);
                        }}
                        disabled={addSaving}
                      >
                        Cancel
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={handleAddItem}
                        disabled={addSaving}
                      >
                        {addSaving ? <Spinner className="h-4 w-4" /> : "Save Item"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Edit-bundle dialog */}
      <Dialog open={editBundleOpen} onOpenChange={(v) => !v && setEditBundleOpen(false)}>
        <DialogContent onClose={() => setEditBundleOpen(false)}>
          <DialogHeader>
            <DialogTitle>Edit Bundle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="edit-code">Bundle Code</Label>
              <Input
                id="edit-code"
                value={editBundleCode}
                onChange={(e) => setEditBundleCode(e.target.value.toUpperCase())}
                disabled={editBundleSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">Bundle Name</Label>
              <Input
                id="edit-name"
                value={editBundleName}
                onChange={(e) => setEditBundleName(e.target.value)}
                placeholder="optional"
                disabled={editBundleSaving}
              />
            </div>
            {editBundleError && (
              <Alert variant="destructive">
                <AlertDescription>{editBundleError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBundleOpen(false)} disabled={editBundleSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveBundle} disabled={editBundleSaving}>
              {editBundleSaving ? <Spinner className="h-4 w-4" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit-item dialog */}
      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent onClose={() => setEditTarget(null)}>
          <DialogHeader>
            <DialogTitle>Edit item</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <BundleItemForm
              value={editDraft}
              onChange={setEditDraft}
              disabled={editSaving}
            />
            {editError && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving ? <Spinner className="h-4 w-4" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item delete confirm */}
      <Dialog open={confirmItem != null} onOpenChange={(v) => !v && setConfirmItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this item?</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmItem(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmItem != null && handleDeleteItem(confirmItem)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image delete confirm */}
      <Dialog open={confirmImage != null} onOpenChange={(v) => !v && setConfirmImage(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this media file?</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmImage(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmImage != null && handleDeleteImage(confirmImage)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full-screen preview */}
      {previewIdx != null && (
        <MediaPreviewOverlay
          items={previewItems}
          index={previewIdx}
          onChangeIndex={setPreviewIdx}
          onClose={() => setPreviewIdx(null)}
        />
      )}
    </div>
  );
}
