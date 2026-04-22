"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { MediaThumb } from "@/components/media-thumb";
import { MediaPreviewOverlay, type PreviewItem } from "@/components/media-preview-overlay";
import { useToast } from "@/components/toaster";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import {
  createBundle,
  addBundleItem,
  updateBundleStatus,
  extractConflictDetail,
  type BundleCodeExistsCreateError,
} from "@/lib/queries";
import { isVideoFilename } from "@/lib/media";
import { useUploadQueue } from "@/contexts/upload-queue-context";
import { useAuth } from "@/contexts/auth-context";
import { MediaPicker } from "@/components/media-picker";

interface DraftItem {
  gender: string;
  brand: string;
  article: string;
  number_of_pieces: number;
  gift_pcs: number;
  grade: string;
  size_variation: string;
  comments: string;
}

const GENDERS = ["Men", "Women", "Unisex", "Kids"];
const GRADES = ["A", "B", "C", "A/B", "B/C", "A/B/C"];

const emptyItem: DraftItem = {
  gender: "Men",
  brand: "",
  article: "",
  number_of_pieces: 0,
  gift_pcs: 0,
  grade: "A",
  size_variation: "",
  comments: "",
};

export default function NewBundlePage() {
  const { ready } = useAuthGuard();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const uploadQueue = useUploadQueue();
  const { role } = useAuth();
  // Only Admin + Content Creators may create bundles. Listing
  // Executives get bounced so they can't reach this form by URL.
  const canCreate = role === "Admin" || role === "Content Creators";

  const [media, setMedia] = useState<File[]>([]);
  const [bundleCode, setBundleCode] = useState("");
  const [bundleName, setBundleName] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [draft, setDraft] = useState<DraftItem>(emptyItem);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{
    label: string;
    value: number; // 0..1
  } | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  // Overwrite-confirm state. When the user submits a form whose code
  // already exists, we stash the conflict detail and open a dialog so
  // the admin can decide whether to delete the existing bundle.
  const [overwriteConflict, setOverwriteConflict] =
    useState<BundleCodeExistsCreateError | null>(null);

  const previewUrls = useMemo(
    () => media.map((f) => ({ name: f.name, url: URL.createObjectURL(f), isVideo: isVideoFilename(f.name) })),
    [media]
  );

  const overlayItems: PreviewItem[] = useMemo(
    () => previewUrls.map((p) => ({ url: p.url, isVideo: p.isVideo, name: p.name })),
    [previewUrls]
  );

  // Kick non-creators back to the list once auth has hydrated.
  useEffect(() => {
    if (ready && !canCreate) {
      router.replace("/bundles");
    }
  }, [ready, canCreate, router]);

  if (!ready || !canCreate) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const handleAddFiles = (files: FileList | null) => {
    if (!files) return;
    setMedia((prev) => [...prev, ...Array.from(files)]);
  };

  const removeMedia = (idx: number) => {
    setMedia((prev) => prev.filter((_, i) => i !== idx));
  };

  const addItem = () => {
    if (!draft.brand.trim() || !draft.article.trim() || draft.number_of_pieces <= 0 || !draft.size_variation.trim()) {
      setError("Brand, article, pieces (>0), and size variation are required for each item.");
      return;
    }
    setItems((prev) => [...prev, draft]);
    setDraft(emptyItem);
    setError(null);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Core submit flow, split out so we can call it from the overwrite
  // confirmation button too.
  const runSubmit = async ({ overwrite }: { overwrite: boolean }) => {
    setError(null);
    if (!bundleCode.trim()) {
      setError("Bundle code is required.");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one item.");
      return;
    }

    setSubmitting(true);
    try {
      // 1) Create bundle
      setProgress({ label: "Creating bundle…", value: 0.05 });
      const code = bundleCode.trim().toUpperCase();
      await createBundle(code, bundleName.trim() || undefined, { overwrite });

      // 2) Items
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await addBundleItem(code, {
          gender: it.gender,
          brand: it.brand,
          article: it.article,
          number_of_pieces: it.number_of_pieces,
          gift_pcs: it.gift_pcs,
          grade: it.grade,
          size_variation: it.size_variation,
          comments: it.comments || null,
        });
        setProgress({
          label: `Adding items (${i + 1}/${items.length})`,
          value: 0.05 + 0.1 * ((i + 1) / items.length),
        });
      }

      // 3) If there's any media, hand compression+upload off to the
      // background queue. Media-less bundles skip this entirely.
      if (media.length > 0) {
        uploadQueue.enqueue({
          bundleCode: code,
          files: media,
          onComplete: () => updateBundleStatus(code, "uploaded"),
        });
      }

      queryClient.invalidateQueries({ queryKey: ["bundles"] });
      router.replace("/bundles");
    } catch (e) {
      // Bundle-code collision on the initial call: open the overwrite
      // confirmation instead of spitting a raw error at the user.
      const conflict = extractConflictDetail<BundleCodeExistsCreateError>(e);
      if (conflict && conflict.code === "bundle_code_exists" && !overwrite) {
        setOverwriteConflict(conflict);
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      setError(`Upload failed: ${message}`);
      toast({ title: "Upload failed", description: message, variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => runSubmit({ overwrite: false });

  const handleConfirmOverwrite = async () => {
    setOverwriteConflict(null);
    await runSubmit({ overwrite: true });
  };

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => router.back()} disabled={submitting}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="font-semibold">New Bundle</h1>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {/* Capture buttons */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">Media</h2>
            <MediaPicker
              onFiles={(f) => handleAddFiles(f)}
              disabled={submitting}
              size="lg"
            />


            {previewUrls.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {previewUrls.map((p, idx) => (
                  <MediaThumb
                    key={`${p.name}-${idx}`}
                    url={p.url}
                    isVideo={p.isVideo}
                    alt={p.name}
                    onClick={() => setPreviewIdx(idx)}
                    showRemove={!submitting}
                    onRemove={() => removeMedia(idx)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bundle metadata */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">Bundle Details</h2>
            <div className="space-y-2">
              <Label htmlFor="code">Bundle Code *</Label>
              <Input
                id="code"
                value={bundleCode}
                onChange={(e) => setBundleCode(e.target.value.toUpperCase())}
                placeholder="e.g. ABC123"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Bundle Name</Label>
              <Input
                id="name"
                value={bundleName}
                onChange={(e) => setBundleName(e.target.value)}
                placeholder="optional"
                disabled={submitting}
              />
            </div>
          </CardContent>
        </Card>

        {/* Item entry */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">Add Item</h2>
            <div className="space-y-2">
              <Label>Gender</Label>
              <Select
                value={draft.gender}
                onChange={(e) => setDraft({ ...draft, gender: e.target.value })}
                disabled={submitting}
              >
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Brand(s)</Label>
              <Input
                value={draft.brand}
                onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                placeholder="e.g. Nike, Adidas"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label>Article(s)</Label>
              <Input
                value={draft.article}
                onChange={(e) => setDraft({ ...draft, article: e.target.value })}
                placeholder="e.g. Hoodie, T-Shirt"
                disabled={submitting}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label>Pieces *</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={draft.number_of_pieces || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, number_of_pieces: parseInt(e.target.value || "0", 10) })
                  }
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label>Gift Pcs</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={draft.gift_pcs || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, gift_pcs: parseInt(e.target.value || "0", 10) })
                  }
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label>Grade</Label>
                <Select
                  value={draft.grade}
                  onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
                  disabled={submitting}
                >
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Size Variation *</Label>
              <Input
                value={draft.size_variation}
                onChange={(e) => setDraft({ ...draft, size_variation: e.target.value })}
                placeholder="e.g. S to XXL"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label>Comments</Label>
              <Textarea
                value={draft.comments}
                onChange={(e) => setDraft({ ...draft, comments: e.target.value })}
                placeholder="optional"
                disabled={submitting}
              />
            </div>
            <Button variant="outline" onClick={addItem} disabled={submitting} className="w-full">
              <Plus className="h-4 w-4" /> Add Item
            </Button>
          </CardContent>
        </Card>

        {/* Items list */}
        {items.length > 0 && (
          <Card>
            <CardContent className="space-y-2 pt-6">
              <h2 className="text-sm font-semibold">Items ({items.length})</h2>
              {items.map((it, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium">
                      {it.brand} — {it.article}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {it.gender} · qty {it.number_of_pieces} · grade {it.grade}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={submitting}
                    onClick={() => removeItem(idx)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {progress && submitting && (
          <Card>
            <CardContent className="space-y-2 pt-6">
              <p className="text-sm font-medium">{progress.label}</p>
              <Progress value={progress.value * 100} />
            </CardContent>
          </Card>
        )}

        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="h-12 w-full text-base"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit Bundle"}
        </Button>
      </div>

      {previewIdx != null && (
        <MediaPreviewOverlay
          items={overlayItems}
          index={previewIdx}
          onChangeIndex={setPreviewIdx}
          onClose={() => setPreviewIdx(null)}
        />
      )}

      {/* Overwrite confirmation. Fires when the user submits a bundle
          whose code is already taken. Agreeing wipes the existing bundle
          (row + items + images + uploads folder) and retries the submit
          against the freed code. */}
      <Dialog
        open={!!overwriteConflict}
        onOpenChange={(v) => !v && setOverwriteConflict(null)}
      >
        <DialogContent onClose={() => setOverwriteConflict(null)}>
          <DialogHeader>
            <DialogTitle>Overwrite existing bundle?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Bundle{" "}
            <span className="font-mono font-semibold">
              {overwriteConflict?.bundle_code}
            </span>{" "}
            already exists
            {overwriteConflict?.bundle_name ? (
              <> (&ldquo;{overwriteConflict.bundle_name}&rdquo;)</>
            ) : null}
            . Overwriting will{" "}
            <strong>permanently delete</strong> its{" "}
            {overwriteConflict?.item_count ?? 0} item
            {overwriteConflict?.item_count === 1 ? "" : "s"} and{" "}
            {overwriteConflict?.image_count ?? 0} media file
            {overwriteConflict?.image_count === 1 ? "" : "s"} before
            creating the new one. This cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOverwriteConflict(null)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmOverwrite}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Overwrite"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
