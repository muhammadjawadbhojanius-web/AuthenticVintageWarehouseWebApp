"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const blurTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  const exactMatch = options.some(
    (o) => o.name.toLowerCase() === query.trim().toLowerCase(),
  );

  const showCreate = query.trim().length > 0 && !exactMatch;

  function openDropdown() {
    if (disabled) return;
    setOpen(true);
  }

  function closeDropdown() {
    setOpen(false);
    setQuery("");
  }

  function handleSelect(name: string) {
    onChange(name);
    closeDropdown();
  }

  async function handleCreate() {
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    try {
      await onCreatePending(name);
      onChange(name);
      closeDropdown();
    } finally {
      setCreating(false);
    }
  }

  // Blur closes the dropdown, but with a delay so option clicks fire first.
  function handleBlur() {
    blurTimerRef.current = setTimeout(closeDropdown, 150);
  }

  // Any mousedown inside the dropdown cancels the blur-close so the click
  // on an option can complete before the input loses focus.
  function handleDropdownMouseDown(e: React.MouseEvent) {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    e.preventDefault(); // keep input focused
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const first = listRef.current?.querySelector<HTMLButtonElement>("button");
      first?.focus();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length === 1) {
        handleSelect(filtered[0].name);
      } else if (exactMatch) {
        const match = options.find(
          (o) => o.name.toLowerCase() === query.trim().toLowerCase(),
        );
        if (match) handleSelect(match.name);
      } else if (showCreate) {
        handleCreate();
      }
      return;
    }
    if (e.key === "Escape") {
      closeDropdown();
      inputRef.current?.blur();
    }
    // Tab: let the browser move focus naturally; blur handler closes the dropdown.
  }

  function handleOptionKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    action: () => void,
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      action();
      inputRef.current?.focus();
      return;
    }
    if (e.key === "Escape") {
      closeDropdown();
      inputRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = e.currentTarget.closest("li")
        ?.nextElementSibling
        ?.querySelector<HTMLButtonElement>("button");
      next?.focus();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = e.currentTarget.closest("li")
        ?.previousElementSibling
        ?.querySelector<HTMLButtonElement>("button");
      if (prev) prev.focus();
      else inputRef.current?.focus();
    }
  }

  return (
    <div className="relative w-full">
      {/* Single input — acts as both trigger and search field */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={open ? query : value}
          placeholder={open ? "Type to filter…" : placeholder}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            openDropdown();
          }}
          onFocus={() => {
            setQuery("");
            openDropdown();
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background py-2 pl-3 pr-9 text-sm ring-offset-background",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
        {/* Right icon: warning when pending, chevron otherwise */}
        {isPending && value ? (
          <AlertTriangle className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-amber-500" />
        ) : (
          <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
        )}
      </div>

      {isPending && value && (
        <p className="mt-1 text-xs text-amber-500">Pending Admin approval</p>
      )}

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-md border border-input bg-background shadow-lg"
          onMouseDown={handleDropdownMouseDown}
        >
          <ul ref={listRef} className="max-h-52 overflow-y-auto py-1">
            {filtered.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                  onClick={() => { handleSelect(opt.name); inputRef.current?.focus(); }}
                  onKeyDown={(e) => handleOptionKeyDown(e, () => handleSelect(opt.name))}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      value === opt.name ? "opacity-100" : "opacity-0",
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
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-amber-600 hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-50"
                  onClick={() => { handleCreate(); }}
                  onKeyDown={(e) => handleOptionKeyDown(e, handleCreate)}
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
