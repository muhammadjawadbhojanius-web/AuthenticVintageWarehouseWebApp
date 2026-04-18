"use client";

import * as React from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error" | "warning";

interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (t: Omit<Toast, "id" | "variant"> & { variant?: ToastVariant }) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let toastIdCounter = 0;

// Any toast whose (variant + title + description) key matches one fired
// within this window is dropped. Catches double-tap on mobile, React
// StrictMode effect double-fires in dev, and accidental double call-sites
// without each caller needing its own debounce.
const DEDUPE_WINDOW_MS = 1200;
const TOAST_LIFETIME_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const recentKeysRef = React.useRef<Map<string, number>>(new Map());

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: Omit<Toast, "id" | "variant"> & { variant?: ToastVariant }) => {
      const variant = t.variant ?? "default";
      const key = `${variant}|${t.title}|${t.description ?? ""}`;
      const now = Date.now();
      const last = recentKeysRef.current.get(key);
      if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
        return;
      }
      recentKeysRef.current.set(key, now);
      // Housekeeping — drop expired keys so the map doesn't grow.
      recentKeysRef.current.forEach((ts, k) => {
        if (now - ts > DEDUPE_WINDOW_MS * 4) recentKeysRef.current.delete(k);
      });

      const id = ++toastIdCounter;
      const newToast: Toast = {
        id,
        title: t.title,
        description: t.description,
        variant,
      };
      setToasts((prev) => [...prev, newToast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, TOAST_LIFETIME_MS);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Visual language is tuned to match the rest of the app:
//   - left accent bar matches the bundle-card thumbnail accent
//   - tinted icon chip mirrors the "3 PHOTOS" badge on the card
//   - rounded-lg + bg-card + border + shadow match the Dialog / Card shells
//   - font-semibold title + muted-foreground description match card text
// ---------------------------------------------------------------------------

interface ToneClasses {
  bar: string;
  border: string;
  iconBg: string;
  iconFg: string;
  Icon: React.ComponentType<{ className?: string }>;
}

function toneFor(variant: ToastVariant): ToneClasses {
  switch (variant) {
    case "success":
      return {
        bar: "bg-success",
        border: "border-success/30",
        iconBg: "bg-success/15",
        iconFg: "text-success",
        Icon: CheckCircle2,
      };
    case "error":
      return {
        bar: "bg-destructive",
        border: "border-destructive/30",
        iconBg: "bg-destructive/15",
        iconFg: "text-destructive",
        Icon: XCircle,
      };
    case "warning":
      return {
        bar: "bg-warning",
        border: "border-warning/30",
        iconBg: "bg-warning/15",
        iconFg: "text-warning",
        Icon: AlertTriangle,
      };
    default:
      return {
        bar: "bg-muted-foreground/40",
        border: "border-border",
        iconBg: "bg-muted",
        iconFg: "text-muted-foreground",
        Icon: Info,
      };
  }
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 sm:bottom-4 sm:right-4 sm:max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = toneFor(t.variant);
  const Icon = tone.Icon;
  return (
    <div
      className={cn(
        "pointer-events-auto relative flex items-stretch overflow-hidden rounded-lg border bg-card shadow-lg transition-all",
        "animate-in slide-in-from-bottom-2 fade-in",
        tone.border,
      )}
      role={t.variant === "error" ? "alert" : "status"}
    >
      <span aria-hidden className={cn("w-[3px] shrink-0", tone.bar)} />
      <div className="flex min-w-0 flex-1 items-start gap-3 p-3 pr-10">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            tone.iconBg,
          )}
          aria-hidden
        >
          <Icon className={cn("h-4 w-4", tone.iconFg)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-foreground">
            {t.title}
          </p>
          {t.description && (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {t.description}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
