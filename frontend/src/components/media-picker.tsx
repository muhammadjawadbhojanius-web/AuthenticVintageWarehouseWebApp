"use client";

import * as React from "react";
import { Camera, Video as VideoIcon, ImagePlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

// Single "Add Media" entry point with an iOS-style action sheet offering
// Take Photo / Take Video / Choose from Gallery. Uniform across all
// platforms.

interface MediaPickerProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  size?: "sm" | "lg";
}

export function MediaPicker({ onFiles, disabled, size = "lg" }: MediaPickerProps) {
  const [open, setOpen] = React.useState(false);
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  const photoInputRef = React.useRef<HTMLInputElement>(null);
  const videoInputRef = React.useRef<HTMLInputElement>(null);
  const galleryInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (sheetRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = (ref: React.RefObject<HTMLInputElement>) => {
    setOpen(false);
    // Defer so the menu close doesn't race the file dialog opening.
    setTimeout(() => ref.current?.click(), 0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Extract File objects into a plain array BEFORE clearing the input.
    // Chrome on Windows mutates the same FileList object when value is reset,
    // so any reference captured after the clear returns an empty list.
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (files.length > 0) onFiles(files);
  };

  const buttonClass =
    size === "sm" ? "h-16 w-full flex-col text-xs" : "h-20 w-full flex-col";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <div className="relative">
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handleChange}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={handleChange}
      />

      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        className={buttonClass}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className={iconSize} />
        Add Media
      </Button>

      {open && (
        <div
          ref={sheetRef}
          className="absolute left-1/2 top-[calc(100%+0.5rem)] z-30 w-56 -translate-x-1/2 overflow-hidden rounded-lg border bg-background shadow-xl"
          role="menu"
        >
          <SheetItem
            icon={<Camera className="h-4 w-4" />}
            label="Take Photo"
            onClick={() => pick(photoInputRef)}
          />
          <SheetItem
            icon={<VideoIcon className="h-4 w-4" />}
            label="Take Video"
            onClick={() => pick(videoInputRef)}
          />
          <SheetItem
            icon={<ImagePlus className="h-4 w-4" />}
            label="Choose from Gallery"
            onClick={() => pick(galleryInputRef)}
          />
        </div>
      )}
    </div>
  );
}

function SheetItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b px-4 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-accent focus:bg-accent focus:outline-none"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
