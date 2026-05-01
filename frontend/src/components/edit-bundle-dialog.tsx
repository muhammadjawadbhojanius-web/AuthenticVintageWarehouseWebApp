"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { BundleCodeExistsUpdateError } from "@/lib/queries";

export interface EditBundleDialogProps {
  open: boolean;
  bundleCode: string;
  bundleName: string;
  error: string | null;
  saving: boolean;
  onBundleCodeChange: (v: string) => void;
  onBundleNameChange: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
  swapConflict: BundleCodeExistsUpdateError | null;
  swapping: boolean;
  onSwapClose: () => void;
  onSwapConfirm: () => void;
}

export function EditBundleDialog({
  open,
  bundleCode,
  bundleName,
  error,
  saving,
  onBundleCodeChange,
  onBundleNameChange,
  onClose,
  onSave,
  swapConflict,
  swapping,
  onSwapClose,
  onSwapConfirm,
}: EditBundleDialogProps) {
  return (
    <>
      {/* Rename bundle code / name */}
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent onClose={onClose}>
          <DialogHeader>
            <DialogTitle>Edit Bundle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="edit-code">Bundle Code</Label>
              <Input
                id="edit-code"
                value={bundleCode}
                onChange={(e) => onBundleCodeChange(e.target.value.toUpperCase())}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">Bundle Name</Label>
              <Input
                id="edit-name"
                value={bundleName}
                onChange={(e) => onBundleNameChange(e.target.value)}
                placeholder="optional"
                disabled={saving}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Swap-codes confirmation. Fires when the admin tries to rename
          a bundle to a code that's already in use — offers to swap the
          two bundles' codes (folders, file names, and DB rows) in one
          atomic server operation. */}
      <Dialog
        open={!!swapConflict}
        onOpenChange={(v) => !v && !swapping && onSwapClose()}
      >
        <DialogContent onClose={swapping ? undefined : onSwapClose}>
          <DialogHeader>
            <DialogTitle>Swap bundle codes?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Bundle{" "}
              <span className="font-mono font-semibold">
                {swapConflict?.new_code}
              </span>{" "}
              already exists
              {swapConflict?.existing_bundle_name
                ? ` ("${swapConflict.existing_bundle_name}")`
                : null}
              . Would you like to swap the two bundles&rsquo; codes?
            </p>
            <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono">
              <div>
                <span className="text-muted-foreground">this bundle:</span>{" "}
                <span className="font-semibold">{swapConflict?.old_code}</span>{" "}
                <span className="text-muted-foreground">→</span>{" "}
                <span className="font-semibold">{swapConflict?.new_code}</span>
              </div>
              <div className="mt-1">
                <span className="text-muted-foreground">other bundle:</span>{" "}
                <span className="font-semibold">{swapConflict?.new_code}</span>{" "}
                <span className="text-muted-foreground">→</span>{" "}
                <span className="font-semibold">{swapConflict?.old_code}</span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                ({swapConflict?.existing_item_count ?? 0} item
                {swapConflict?.existing_item_count === 1 ? "" : "s"},{" "}
                {swapConflict?.existing_image_count ?? 0} media file
                {swapConflict?.existing_image_count === 1 ? "" : "s"} live on
                the other bundle)
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Folders, file names, and database paths move together — nothing
              is lost.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onSwapClose} disabled={swapping}>
              Cancel
            </Button>
            <Button onClick={onSwapConfirm} disabled={swapping}>
              {swapping ? <Spinner className="h-4 w-4" /> : "Swap codes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
