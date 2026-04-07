"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Trash2,
  Pencil,
  Plus,
  Camera,
  Video as VideoIcon,
  ImagePlus,
  ClipboardCopy,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
} from "@/lib/queries";
import { uploadFilesParallel } from "@/lib/chunked-upload";
import { mediaUrlFor, isVideoFilename } from "@/lib/media";
import { copyBundleToClipboard } from "@/lib/clipboard-template";
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

  // Copy-to-clipboard state
  const [copying, setCopying] = useState(false);

  // Add-media state
  const [uploadProgress, setUploadProgress] = useState<{ label: string; value: number } | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const bundleQuery = useQuery({
    queryKey: ["bundle", code],
    queryFn: () => fetchBundle(code),
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
      await copyBundleToClipboard(bundleQuery.data);
      toast({ title: "Bundle details copied", variant: "success" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Copy failed", description: msg, variant: "error" });
    } finally {
      setCopying(false);
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

  const handleAddFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploadProgress({ label: "Starting…", value: 0 });
    try {
      await uploadFilesParallel({
        bundleCode: code,
        files: list,
        fileConcurrency: 2,
        onProgress: ({ overall, label }) => {
          setUploadProgress({ label, value: overall });
        },
      });
      toast({ title: "Media uploaded", variant: "success" });
      refreshBundle();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Upload failed", description: msg, variant: "error" });
    } finally {
      setUploadProgress(null);
      if (photoInputRef.current) photoInputRef.current.value = "";
      if (videoInputRef.current) videoInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
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
              <Badge variant="secondary">
                {bundleQuery.data.status.toUpperCase()}
              </Badge>
            </>
          )}
        </div>

        {bundleQuery.isLoading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}

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
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className="hidden"
                      onChange={(e) => handleAddFiles(e.target.files)}
                    />
                    <input
                      ref={videoInputRef}
                      type="file"
                      accept="video/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handleAddFiles(e.target.files)}
                    />
                    <input
                      ref={galleryInputRef}
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleAddFiles(e.target.files)}
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <Button
                        variant="outline"
                        className="h-16 flex-col text-xs"
                        disabled={!!uploadProgress}
                        onClick={() => photoInputRef.current?.click()}
                      >
                        <Camera className="h-4 w-4" />
                        Photo
                      </Button>
                      <Button
                        variant="outline"
                        className="h-16 flex-col text-xs"
                        disabled={!!uploadProgress}
                        onClick={() => videoInputRef.current?.click()}
                      >
                        <VideoIcon className="h-4 w-4" />
                        Video
                      </Button>
                      <Button
                        variant="outline"
                        className="h-16 flex-col text-xs"
                        disabled={!!uploadProgress}
                        onClick={() => galleryInputRef.current?.click()}
                      >
                        <ImagePlus className="h-4 w-4" />
                        Gallery
                      </Button>
                    </div>
                    {uploadProgress && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{uploadProgress.label}</p>
                        <Progress value={uploadProgress.value * 100} />
                      </div>
                    )}
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
