"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/toaster";
import { validateBundleCodes } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Routes pasted bundle codes through the existing bulk-confirm + execution
// flow on /bundles. Validates against the DB first so a typo never reaches
// DELETE / PATCH calls. The action shape exactly matches the sticky-bar
// state in bundles/page.tsx, so the parent can hand it straight to
// setBulkConfirm without any translation.
export type BulkAction =
  | { kind: "delete" }
  | { kind: "status"; target: 0 | 1 | 2 };

interface BulkByListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the Delete tile is shown — admin-only, mirroring the sticky bar. */
  canDelete: boolean;
  /** Fired only after every code has been confirmed to exist. */
  onSubmit: (codes: string[], action: BulkAction) => void;
}

// Split on common spreadsheet separators, strip surrounding quotes, uppercase
// + dedupe. Order is preserved so the live preview is stable.
function parseCodes(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,;|]+/)
        .map((s) => s.trim().replace(/^["'`]+|["'`]+$/g, "").toUpperCase())
        .filter(Boolean),
    ),
  );
}

export function BulkByListDialog({
  open,
  onOpenChange,
  canDelete,
  onSubmit,
}: BulkByListDialogProps) {
  const { toast } = useToast();

  const [text, setText] = useState("");
  const [action, setAction] = useState<BulkAction | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [validating, setValidating] = useState(false);

  // Reset every time the dialog opens so a previous attempt's state doesn't
  // leak into a new session.
  useEffect(() => {
    if (open) {
      setText("");
      setAction(null);
      setMissing([]);
      setValidating(false);
    }
  }, [open]);

  const codes = useMemo(() => parseCodes(text), [text]);
  const previewCodes = codes.slice(0, 20);
  const overflow = Math.max(0, codes.length - previewCodes.length);

  // Continue is gated on having codes, an action, no flagged-missing chips
  // since the last edit, and no in-flight validation request.
  const canContinue =
    codes.length > 0 && action !== null && missing.length === 0 && !validating;

  const handleContinue = async () => {
    if (!canContinue || !action) return;
    setValidating(true);
    try {
      const { valid, missing: srvMissing } = await validateBundleCodes(codes);
      if (srvMissing.length > 0) {
        setMissing(srvMissing);
        return;
      }
      onSubmit(valid, action);
    } catch {
      toast({ title: "Could not validate codes", variant: "error" });
    } finally {
      setValidating(false);
    }
  };

  // Strips the codes the server flagged as missing from the textarea so the
  // user can hit Continue again on a clean list. Re-serialised newline-per-
  // code for readability.
  const removeMissingFromList = () => {
    if (missing.length === 0) return;
    const dropped = new Set(missing);
    const kept = codes.filter((c) => !dropped.has(c));
    setText(kept.join("\n"));
    setMissing([]);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !validating && onOpenChange(v)}>
      <DialogContent
        className="max-w-xl max-h-[calc(100dvh-2rem)]"
        onClose={validating ? undefined : () => onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-muted-foreground" />
            Bulk Action By List
          </DialogTitle>
          <DialogDescription>
            Paste or type bundle codes — one per line, or separated by commas
            or spaces. Codes are validated before any action runs.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable middle so a huge missing-codes list can never push the
            footer off-screen. Header and footer stay pinned. */}
        <div className="-mx-1 flex-1 min-h-0 space-y-4 overflow-y-auto px-1">
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                // Editing clears the missing-flag so Continue can re-arm.
                if (missing.length > 0) setMissing([]);
              }}
              placeholder="AV-0001, AV-0002&#10;AVG-0003"
              rows={6}
              className="font-mono text-sm"
              disabled={validating}
              spellCheck={false}
            />

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {codes.length === 0
                  ? "No codes yet"
                  : `${codes.length} code${codes.length === 1 ? "" : "s"} recognized`}
              </span>
            </div>

            {previewCodes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {previewCodes.map((c) => {
                  const isMissing = missing.includes(c);
                  return (
                    <span
                      key={c}
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[11px]",
                        isMissing
                          ? "border-destructive/60 bg-destructive/10 text-destructive"
                          : "border-border bg-muted/50",
                      )}
                    >
                      {c}
                    </span>
                  );
                })}
                {overflow > 0 && (
                  <span className="rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    +{overflow} more
                  </span>
                )}
              </div>
            )}
          </div>

          {missing.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  Not found in database ({missing.length})
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-destructive/50 bg-background text-destructive hover:bg-destructive/10"
                  onClick={removeMissingFromList}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove from list
                </Button>
              </div>
              <p className="mt-1 text-xs">
                Click <strong>Remove from list</strong> to keep only the codes
                that exist, or edit the textarea to fix typos.
              </p>
              {/* Inner scroll so even a 200-code rejection list stays
                  bounded and never crowds out the action selector below. */}
              <div className="mt-2 max-h-32 overflow-y-auto rounded border border-destructive/30 bg-background/40 p-1.5">
                <div className="flex flex-wrap gap-1">
                  {missing.map((c) => (
                    <span
                      key={c}
                      className="rounded border border-destructive/60 bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Action
            </p>
            <div
              className={cn(
                "grid gap-2",
                canDelete ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
              )}
            >
              <ActionTile
                label="Draft"
                active={action?.kind === "status" && action.target === 0}
                onClick={() => setAction({ kind: "status", target: 0 })}
                disabled={validating}
              />
              <ActionTile
                label="Posted"
                active={action?.kind === "status" && action.target === 1}
                onClick={() => setAction({ kind: "status", target: 1 })}
                disabled={validating}
              />
              <ActionTile
                label="Sold"
                active={action?.kind === "status" && action.target === 2}
                onClick={() => setAction({ kind: "status", target: 2 })}
                disabled={validating}
              />
              {canDelete && (
                <ActionTile
                  label="Delete"
                  tone="destructive"
                  active={action?.kind === "delete"}
                  onClick={() => setAction({ kind: "delete" })}
                  disabled={validating}
                />
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={validating}
          >
            Cancel
          </Button>
          <Button onClick={handleContinue} disabled={!canContinue}>
            {validating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionTile({
  label,
  active,
  onClick,
  disabled,
  tone = "default",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50",
        active
          ? tone === "destructive"
            ? "border-destructive bg-destructive/10 text-destructive"
            : "border-primary bg-primary/10 text-primary"
          : "border-input hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}
