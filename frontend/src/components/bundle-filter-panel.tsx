"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string | number;
  label: string;
}

export interface FilterGroup {
  label: string;
  options: FilterOption[];
  value: string | number;
  onChange: (v: string | number) => void;
}

function FilterSegmentedGroup({ label, options, value, onChange }: FilterGroup) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input hover:bg-accent",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface FilterPanelProps {
  anchorRect: DOMRect | null;
  groups: FilterGroup[];
  onClear: (() => void) | null;
  onClose: () => void;
  excludeRef?: React.RefObject<HTMLElement | null>;
}

export function FilterPanel({ anchorRect, groups, onClear, onClose, excludeRef }: FilterPanelProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (excludeRef?.current?.contains(e.target as Node)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, excludeRef]);

  if (!anchorRect || typeof document === "undefined") return null;

  const estimatedHeight = 370;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUp = spaceBelow < estimatedHeight + 8;
  const top = openUp
    ? Math.max(8, anchorRect.top - estimatedHeight - 4)
    : anchorRect.bottom + 4;
  const right = Math.max(8, window.innerWidth - anchorRect.right);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Filters"
      className="fixed z-[60] w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-lg border bg-background shadow-lg"
      style={{ top, right }}
    >
      <div className="space-y-3 p-3">
        {groups.map((g) => (
          <FilterSegmentedGroup key={g.label} {...g} />
        ))}
        {onClear && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
