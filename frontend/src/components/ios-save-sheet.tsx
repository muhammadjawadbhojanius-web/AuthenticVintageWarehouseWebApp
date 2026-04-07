"use client";

import { useEffect, useState } from "react";
import { Image as ImageIcon, Video, Share } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fetchAsFile, shareFile, anchorDownload } from "@/lib/ios-download";

interface IOSSaveSheetProps {
  open: boolean;
  url: string;
  fileName: string;
  onClose: () => void;
  onResult?: (result: "shared" | "fallback" | "cancelled") => void;
}

/**
 * Pre-fetches a file when opened, then shows a "Save to Photos" button.
 * The button click is the user gesture iOS Safari needs to invoke navigator.share.
 */
export function IOSSaveSheet({ open, url, fileName, onClose, onResult }: IOSSaveSheetProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const f = await fetchAsFile(url, fileName);
        if (!cancelled) setFile(f);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, url, fileName]);

  const isVideo = (file?.type ?? "").startsWith("video");

  const handleShare = async () => {
    if (!file) return;
    const ok = await shareFile(file);
    if (ok) {
      onResult?.("shared");
    } else {
      // Share failed or unsupported — fall back to anchor download
      anchorDownload(file);
      onResult?.("fallback");
    }
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="max-w-md mx-auto">
        <SheetHeader>
          <div className="mx-auto">
            {isVideo ? (
              <Video className="h-12 w-12 text-primary" />
            ) : (
              <ImageIcon className="h-12 w-12 text-primary" />
            )}
          </div>
          <SheetTitle className="truncate">{fileName}</SheetTitle>
          <SheetDescription>
            {file
              ? `Tap below, then choose "Save ${isVideo ? "Video" : "Image"}" in the share sheet to save to Photos.`
              : error
              ? `Failed to prepare file: ${error}`
              : "Preparing file..."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-2">
          <Button onClick={handleShare} disabled={!file} className="w-full" size="lg">
            {file ? (
              <>
                <Share className="h-5 w-5" /> Save to Photos
              </>
            ) : (
              <>
                <Spinner className="h-4 w-4" /> Preparing...
              </>
            )}
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full">
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
