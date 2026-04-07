"use client";

import * as React from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle } from "lucide-react";
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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const toast = React.useCallback((t: Omit<Toast, "id" | "variant"> & { variant?: ToastVariant }) => {
    const id = ++toastIdCounter;
    const newToast: Toast = { id, title: t.title, description: t.description, variant: t.variant ?? "default" };
    setToasts((prev) => [...prev, newToast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastViewport toasts={toasts} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

function ToastViewport({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 sm:bottom-4 sm:right-4 sm:max-w-sm">
      {toasts.map((t) => {
        const Icon =
          t.variant === "success"
            ? CheckCircle2
            : t.variant === "error"
            ? XCircle
            : t.variant === "warning"
            ? AlertTriangle
            : Info;
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border bg-background p-4 shadow-lg animate-in slide-in-from-bottom-2",
              t.variant === "success" && "border-success/50 bg-success/5",
              t.variant === "error" && "border-destructive/50 bg-destructive/5",
              t.variant === "warning" && "border-warning/50 bg-warning/5"
            )}
          >
            <Icon
              className={cn(
                "h-5 w-5 shrink-0 mt-0.5",
                t.variant === "success" && "text-success",
                t.variant === "error" && "text-destructive",
                t.variant === "warning" && "text-warning",
                t.variant === "default" && "text-muted-foreground"
              )}
            />
            <div className="flex-1 text-sm">
              <p className="font-medium leading-tight">{t.title}</p>
              {t.description && <p className="mt-1 text-muted-foreground">{t.description}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Empty re-export so the import in providers.tsx works
export function Toaster() {
  return null;
}
