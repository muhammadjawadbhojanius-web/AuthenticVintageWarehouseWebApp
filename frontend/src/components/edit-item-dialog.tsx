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
import { Spinner } from "@/components/ui/spinner";
import {
  BundleItemForm,
  type BundleItemFormValues,
} from "@/components/bundle-item-form";
import type { BundleItem } from "@/lib/types";

export interface EditItemDialogProps {
  item: BundleItem | null;
  draft: BundleItemFormValues;
  error: string | null;
  saving: boolean;
  onDraftChange: (v: BundleItemFormValues) => void;
  onClose: () => void;
  onSave: () => void;
}

export function EditItemDialog({
  item,
  draft,
  error,
  saving,
  onDraftChange,
  onClose,
  onSave,
}: EditItemDialogProps) {
  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Edit item</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <BundleItemForm value={draft} onChange={onDraftChange} disabled={saving} />
          {error && (
            <Alert variant="destructive" className="mt-3">
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
  );
}
