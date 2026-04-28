"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  RefreshCw,
  Search,
  X,
  MapPin,
  Loader2,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useToast } from "@/components/toaster";
import { fetchBundles, updateBundleLocation } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { Bundle } from "@/lib/types";

// Format constraint shared with the backend validator: "AV-NN" or "AVG-NN".
// 1–3 digits to leave headroom; backend uses the same pattern.
const LOCATION_RE = /^(AV|AVG)-\d{1,3}$/i;

export default function BundleLocationsPage() {
  const { ready } = useAuthGuard({ requireRole: "Admin" });
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const bundlesQuery = useQuery({
    queryKey: ["bundles-locations", debouncedSearch],
    queryFn: () =>
      fetchBundles({ search: debouncedSearch || undefined }).then((all) =>
        all.filter((b) => b.posted !== 2),
      ),
    enabled: ready,
  });

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const bundles: Bundle[] = bundlesQuery.data ?? [];

  // Group by location so the warehouse layout is readable. Unassigned
  // bundles get their own bucket at the top so admins immediately see
  // what still needs a location.
  const groups = (() => {
    const map = new Map<string, Bundle[]>();
    for (const b of bundles) {
      const key = (b.location || "").trim() || "__unassigned__";
      const arr = map.get(key) ?? [];
      arr.push(b);
      map.set(key, arr);
    }
    const entries = Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "__unassigned__") return -1;
      if (b === "__unassigned__") return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
    return entries;
  })();

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="font-semibold">Bundle Locations</h1>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={() => bundlesQuery.refetch()}
        >
          <RefreshCw
            className={cn("h-4 w-4", bundlesQuery.isFetching && "animate-spin")}
          />
        </Button>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by bundle code, name, brand, or article…"
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Locations look like <code className="font-mono">AV-01</code> or{" "}
          <code className="font-mono">AVG-12</code>. Multiple bundles can share
          a location. Empty the field and save to clear.
        </p>

        {/* Bulk assign card */}
        <Card>
          <CardContent className="pt-4 pb-3 space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-sm font-semibold"
              onClick={() => setBulkOpen((v) => !v)}
            >
              <span>Bulk Assign</span>
              {bulkOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {bulkOpen && (
              <BulkAssignPanel
                bundles={bundles}
                onApplied={(updates) => {
                  const patch = (old: Bundle[] | undefined) =>
                    Array.isArray(old)
                      ? old.map((x) => {
                          const next = updates.get(x.bundle_code);
                          return next !== undefined ? { ...x, location: next } : x;
                        })
                      : old;
                  queryClient.setQueriesData<Bundle[]>({ queryKey: ["bundles"] }, patch);
                  queryClient.setQueriesData<Bundle[]>({ queryKey: ["bundles-locations"] }, patch);
                  for (const code of Array.from(updates.keys())) {
                    queryClient.invalidateQueries({ queryKey: ["bundle", code] });
                  }
                }}
              />
            )}
          </CardContent>
        </Card>

        {bundlesQuery.isLoading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}

        {bundlesQuery.isSuccess && bundles.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {search ? "No bundles match your search." : "No bundles yet."}
            </CardContent>
          </Card>
        )}

        {groups.map(([key, list]) => (
          <Card key={key}>
            <CardContent className="space-y-2 pt-5">
              <div className="flex items-center gap-2">
                <MapPin
                  className={cn(
                    "h-4 w-4",
                    key === "__unassigned__"
                      ? "text-muted-foreground"
                      : "text-primary",
                  )}
                />
                <h2 className="text-sm font-semibold">
                  {key === "__unassigned__" ? "Unassigned" : key}
                </h2>
                <span className="text-xs text-muted-foreground">
                  ({list.length})
                </span>
                {key !== "__unassigned__" && (
                  <CopyCodesButton codes={list.map((b) => b.bundle_code)} location={key} />
                )}
              </div>
              {list.map((b) => (
                <BundleRow
                  key={b.bundle_code}
                  bundle={b}
                  onSaved={(next) => {
                    const patch = (old: Bundle[] | undefined) =>
                      Array.isArray(old)
                        ? old.map((x) =>
                            x.bundle_code === b.bundle_code
                              ? { ...x, location: next }
                              : x,
                          )
                        : old;
                    queryClient.setQueriesData<Bundle[]>({ queryKey: ["bundles"] }, patch);
                    queryClient.setQueriesData<Bundle[]>({ queryKey: ["bundles-locations"] }, patch);
                    queryClient.invalidateQueries({ queryKey: ["bundle", b.bundle_code] });
                    toast({
                      title: next
                        ? `${b.bundle_code} → ${next}`
                        : `Cleared location for ${b.bundle_code}`,
                      variant: "success",
                    });
                  }}
                />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy codes button — copies the bundle codes for a location to clipboard.
// ---------------------------------------------------------------------------

function CopyCodesButton({ codes, location }: { codes: string[]; location: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(codes.map((c) => `${c} | ${location}`).join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for browsers that block clipboard without HTTPS
      const ta = document.createElement("textarea");
      ta.value = codes.map((c) => `${c} | ${location}`).join("\n");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${codes.length} bundle code${codes.length === 1 ? "" : "s"} for ${location}`}
      className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-success" />
          <span className="text-success">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bulk assign panel
// ---------------------------------------------------------------------------
//
// Format (one per line):  BUNDLE_CODE LOCATION
// Separator between code and location: one or more spaces, tabs, or a comma.
// Examples:
//   AV-0001 AV-01
//   AVG-0023, AVG-03
//   AV-0045	AV-02
//
// Lines starting with # are treated as comments and ignored.
// Blank lines are skipped.

interface ParsedLine {
  raw: string;
  lineNum: number;
  code?: string;
  location?: string;
  error?: string;
}

function parseBulkText(text: string, knownCodes: Set<string>): ParsedLine[] {
  return text
    .split("\n")
    .map((raw, i) => {
      const lineNum = i + 1;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#")) return null;
      // Split on first whitespace or comma sequence
      const parts = trimmed.split(/[\s,]+/, 2);
      if (parts.length < 2) {
        return {
          raw,
          lineNum,
          error: "Expected: BUNDLE_CODE LOCATION",
        };
      }
      const code = parts[0].toUpperCase();
      const location = parts[1].toUpperCase();
      if (!knownCodes.has(code)) {
        return { raw, lineNum, code, location, error: `Bundle "${code}" not found` };
      }
      if (!LOCATION_RE.test(location)) {
        return {
          raw,
          lineNum,
          code,
          location,
          error: `Invalid location "${location}" — use AV-01 or AVG-12`,
        };
      }
      return { raw, lineNum, code, location };
    })
    .filter(Boolean) as ParsedLine[];
}

interface BulkAssignPanelProps {
  bundles: Bundle[];
  onApplied: (updates: Map<string, string | null>) => void;
}

function BulkAssignPanel({ bundles, onApplied }: BulkAssignPanelProps) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const knownCodes = new Set(bundles.map((b) => b.bundle_code));
  const parsed = text.trim() ? parseBulkText(text, knownCodes) : [];
  const valid = parsed.filter((l) => !l.error);
  const errors = parsed.filter((l) => l.error);

  const handleApply = async () => {
    if (busy || valid.length === 0) return;
    setBusy(true);
    const results = await Promise.allSettled(
      valid.map((l) => updateBundleLocation(l.code!, l.location!)),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    const updates = new Map<string, string | null>();
    valid.forEach((l, idx) => {
      if (results[idx].status === "fulfilled") {
        updates.set(l.code!, l.location!);
      }
    });
    onApplied(updates);

    if (failed === 0) {
      toast({ title: `Assigned ${succeeded} location${succeeded === 1 ? "" : "s"}`, variant: "success" });
      setText("");
    } else {
      toast({
        title: `${succeeded} assigned, ${failed} failed`,
        variant: "warning",
      });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        One entry per line:{" "}
        <code className="font-mono">BUNDLE_CODE LOCATION</code>
        {" "}— e.g.{" "}
        <code className="font-mono">AV-0001 AV-01</code>
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"AV-0001 AV-01\nAVG-0023 AVG-03\nAV-0045 AV-02"}
        rows={6}
        disabled={busy}
        className="font-mono text-sm"
      />

      {/* Live parse preview */}
      {parsed.length > 0 && (
        <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs">
          {valid.length > 0 && (
            <p className="font-semibold text-success">
              {valid.length} valid assignment{valid.length === 1 ? "" : "s"}
            </p>
          )}
          {errors.map((l) => (
            <div key={l.lineNum} className="flex items-start gap-1.5 text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Line {l.lineNum}: {l.error}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          onClick={handleApply}
          disabled={busy || valid.length === 0}
          className="flex-1"
        >
          {busy ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Applying…</>
          ) : (
            <>Apply {valid.length > 0 ? valid.length : ""} Assignment{valid.length === 1 ? "" : "s"}</>
          )}
        </Button>
        {text.trim() && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setText("")}
            disabled={busy}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Summary of what will be set — collapsed once > 5 rows to save space */}
      {valid.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {valid.slice(0, 8).map((l) => (
            <Badge
              key={l.code}
              variant="outline"
              className="font-mono text-xs"
            >
              {l.code} → {l.location}
            </Badge>
          ))}
          {valid.length > 8 && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              +{valid.length - 8} more
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

interface BundleRowProps {
  bundle: Bundle;
  onSaved: (next: string | null) => void;
}

function BundleRow({ bundle, onSaved }: BundleRowProps) {
  const { toast } = useToast();
  const initial = bundle.location ?? "";
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Sync if the parent's bundle prop changes (e.g., after a refetch).
  useEffect(() => {
    setValue(bundle.location ?? "");
  }, [bundle.location]);

  const trimmed = value.trim().toUpperCase();
  const dirty = trimmed !== (initial || "").toUpperCase();
  const valid = trimmed === "" || LOCATION_RE.test(trimmed);

  const handleSave = async () => {
    if (busy || !dirty) return;
    if (!valid) {
      toast({
        title: "Invalid location",
        description: "Use the format AV-01 or AVG-12.",
        variant: "error",
      });
      return;
    }
    setBusy(true);
    try {
      await updateBundleLocation(bundle.bundle_code, trimmed || null);
      onSaved(trimmed || null);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1500);
    } catch {
      toast({ title: "Failed to save location", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm font-semibold">
          {bundle.bundle_code}
        </p>
        {bundle.bundle_name && (
          <p className="truncate text-xs italic text-muted-foreground">
            &lsquo;{bundle.bundle_name}&rsquo;
          </p>
        )}
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSave();
          }
        }}
        placeholder="AV-01"
        // Allow lowercase typing; we uppercase on save. Width fits the format.
        className={cn(
          "h-9 w-28 text-center font-mono text-sm uppercase",
          !valid && "border-destructive focus-visible:ring-destructive",
        )}
        disabled={busy}
      />
      <Button
        size="sm"
        variant={dirty ? "default" : "outline"}
        disabled={!dirty || busy || !valid}
        onClick={handleSave}
        className="shrink-0"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : justSaved ? (
          <Check className="h-4 w-4" />
        ) : (
          "Save"
        )}
      </Button>
    </div>
  );
}
