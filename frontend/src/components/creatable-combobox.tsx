"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface ComboboxOption {
  id: number;
  name: string;
}

interface CreatableComboboxProps {
  value: string;
  onChange: (val: string) => void;
  options: ComboboxOption[];
  onCreatePending: (name: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  /** Show an amber "pending approval" badge when the current value isn't approved */
  isPending?: boolean;
}

export function CreatableCombobox({
  value,
  onChange,
  options,
  onCreatePending,
  placeholder = "Select or type…",
  disabled,
  isPending,
}: CreatableComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Close on outside click
  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  const exactMatch = options.some(
    (o) => o.name.toLowerCase() === query.trim().toLowerCase()
  );

  const showCreate = query.trim().length > 0 && !exactMatch;

  async function handleCreate() {
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    try {
      await onCreatePending(name);
      onChange(name);
      setOpen(false);
      setQuery("");
    } finally {
      setCreating(false);
    }
  }

  function handleSelect(name: string) {
    onChange(name);
    setOpen(false);
    setQuery("");
  }

  function handleOpen() {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          !value && "text-muted-foreground"
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {isPending && value && (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          )}
          {value || placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      {isPending && value && (
        <p className="mt-1 text-xs text-amber-500">Pending Admin approval</p>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-input bg-background shadow-lg">
          <div className="p-2">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length === 1) {
                    handleSelect(filtered[0].name);
                  } else if (showCreate) {
                    handleCreate();
                  }
                }
                if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
              }}
            />
          </div>

          <ul className="max-h-52 overflow-y-auto pb-1">
            {filtered.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                  onClick={() => handleSelect(opt.name)}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      value === opt.name ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {opt.name}
                </button>
              </li>
            ))}

            {filtered.length === 0 && !showCreate && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                No results
              </li>
            )}

            {showCreate && (
              <li>
                <button
                  type="button"
                  disabled={creating}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-amber-600 hover:bg-accent disabled:opacity-50"
                  onClick={handleCreate}
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  {creating ? "Submitting…" : `Create "${query.trim()}" (pending approval)`}
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
