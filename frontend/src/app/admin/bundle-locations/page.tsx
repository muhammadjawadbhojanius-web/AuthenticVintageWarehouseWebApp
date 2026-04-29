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
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/toaster";
import {
  fetchBundles,
  fetchLocationEntries,
  upsertLocationEntry,
  deleteLocationEntry,
  bulkUpsertLocationEntries,
  type LocationEntry,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { Bundle } from "@/lib/types";

// Shared format constraint (matches backend validator).
const LOCATION_RE = /^(AV|AVG)-\d{1,3}$/i;

export default function BundleLocationsPage() {
  const { ready } = useAuthGuard();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const { toast } = useToast();
  const isAdmin = role === "Admin";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Authoritative source: location_entries (includes phantom codes).
  const locationsQuery = useQuery({
    queryKey: ["location-entries"],
    queryFn: fetchLocationEntries,
    enabled: ready,
  });

  // Used only to know which codes exist in the DB (for yellow highlighting).
  const bundlesQuery = useQuery({
    queryKey: ["bundles"],
    queryFn: () => fetchBundles({}),
    enabled: ready,
    staleTime: 30_000,
  });

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const allEntries: LocationEntry[] = locationsQuery.data ?? [];
  const dbCodes = new Set((bundlesQuery.data ?? []).map((b: Bundle) => b.bundle_code));

  // Client-side search across bundle_code.
  const filtered = debouncedSearch
    ? allEntries.filter((e) =>
        e.bundle_code.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        e.location.toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : allEntries;

  // Group by location, sorted numerically. Unassigned bucket not needed
  // here because every entry in location_entries has a location.
  const groups = (() => {
    const map = new Map<string, LocationEntry[]>();
    for (const e of filtered) {
      const arr = map.get(e.location) ?? [];
      arr.push(e);
      map.set(e.location, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  })();

  const existingCodes = new Set(allEntries.map((e) => e.bundle_code));

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="font-semibold">Bundle Locations</h1>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => locationsQuery.refetch()}
          >
            <RefreshCw
              className={cn("h-4 w-4", locationsQuery.isFetching && "animate-spin")}
            />
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by bundle code or location…"
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
          Locations: <code className="font-mono">AV-01</code> or{" "}
          <code className="font-mono">AVG-12</code>. Bundle codes not yet in
          the database are shown in{" "}
          <span className="font-semibold text-yellow-500">yellow</span>.
        </p>

        {/* Add single entry — admin only */}
        {isAdmin && (
          <Card>
            <CardContent className="pt-4 pb-3 space-y-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-sm font-semibold"
                onClick={() => setAddOpen((v) => !v)}
              >
                <span className="flex items-center gap-1.5">
                  <Plus className="h-4 w-4" /> Add Entry
                </span>
                {addOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {addOpen && (
                <AddEntryForm
                  dbCodes={dbCodes}
                  onSaved={(entry) => {
                    queryClient.setQueryData<LocationEntry[]>(
                      ["location-entries"],
                      (old) => {
                        if (!old) return [entry];
                        const idx = old.findIndex((e) => e.bundle_code === entry.bundle_code);
                        return idx >= 0
                          ? old.map((e, i) => (i === idx ? entry : e))
                          : [...old, entry];
                      },
                    );
                    queryClient.setQueriesData<Bundle[]>(
                      { queryKey: ["bundles"] },
                      (old) =>
                        Array.isArray(old)
                          ? old.map((b) =>
                              b.bundle_code === entry.bundle_code
                                ? { ...b, location: entry.location }
                                : b,
                            )
                          : old,
                    );
                    toast({ title: `${entry.bundle_code} → ${entry.location}`, variant: "success" });
                  }}
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* Bulk assign — admin only */}
        {isAdmin && (
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
                  onApplied={(saved) => {
                    queryClient.setQueryData<LocationEntry[]>(
                      ["location-entries"],
                      (old) => {
                        const map = new Map((old ?? []).map((e) => [e.bundle_code, e]));
                        for (const e of saved) map.set(e.bundle_code, e);
                        return Array.from(map.values());
                      },
                    );
                    queryClient.setQueriesData<Bundle[]>(
                      { queryKey: ["bundles"] },
                      (old) => {
                        if (!Array.isArray(old)) return old;
                        const byCode = new Map(saved.map((e) => [e.bundle_code, e.location]));
                        return old.map((b) => {
                          const loc = byCode.get(b.bundle_code);
                          return loc !== undefined ? { ...b, location: loc } : b;
                        });
                      },
                    );
                  }}
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* Bulk delete — admin only */}
        {isAdmin && (
          <Card>
            <CardContent className="pt-4 pb-3 space-y-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-sm font-semibold"
                onClick={() => setBulkDeleteOpen((v) => !v)}
              >
                <span className="flex items-center gap-1.5">
                  <Trash2 className="h-4 w-4" /> Bulk Delete
                </span>
                {bulkDeleteOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {bulkDeleteOpen && (
                <BulkDeletePanel
                  existingCodes={existingCodes}
                  onDeleted={(codes) => {
                    queryClient.setQueryData<LocationEntry[]>(
                      ["location-entries"],
                      (old) => (old ?? []).filter((e) => !codes.includes(e.bundle_code)),
                    );
                    queryClient.setQueriesData<Bundle[]>(
                      { queryKey: ["bundles"] },
                      (old) =>
                        Array.isArray(old)
                          ? old.map((b) =>
                              codes.includes(b.bundle_code) ? { ...b, location: null } : b,
                            )
                          : old,
                    );
                  }}
                />
              )}
            </CardContent>
          </Card>
        )}

        {locationsQuery.isLoading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}

        {locationsQuery.isSuccess && allEntries.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No location entries yet. Use Add Entry or Bulk Assign above.
            </CardContent>
          </Card>
        )}

        {locationsQuery.isSuccess && allEntries.length > 0 && filtered.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No entries match &ldquo;{debouncedSearch}&rdquo;.
            </CardContent>
          </Card>
        )}

        {groups.map(([loc, list]) => (
          <Card key={loc}>
            <CardContent className="space-y-2 pt-5">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">{loc}</h2>
                <span className="text-xs text-muted-foreground">({list.length})</span>
                <CopyCodesButton codes={list.map((e) => e.bundle_code)} location={loc} />
              </div>
              {list.map((entry) => (
                <EntryRow
                  key={entry.bundle_code}
                  entry={entry}
                  inDb={dbCodes.has(entry.bundle_code)}
                  canEdit={isAdmin}
                  onSaved={(updated) => {
                    queryClient.setQueryData<LocationEntry[]>(
                      ["location-entries"],
                      (old) =>
                        (old ?? []).map((e) =>
                          e.bundle_code === entry.bundle_code ? updated : e,
                        ),
                    );
                    queryClient.setQueriesData<Bundle[]>(
                      { queryKey: ["bundles"] },
                      (old) =>
                        Array.isArray(old)
                          ? old.map((b) =>
                              b.bundle_code === updated.bundle_code
                                ? { ...b, location: updated.location }
                                : b,
                            )
                          : old,
                    );
                    toast({ title: `${updated.bundle_code} → ${updated.location}`, variant: "success" });
                  }}
                  onDeleted={() => {
                    queryClient.setQueryData<LocationEntry[]>(
                      ["location-entries"],
                      (old) => (old ?? []).filter((e) => e.bundle_code !== entry.bundle_code),
                    );
                    queryClient.setQueriesData<Bundle[]>(
                      { queryKey: ["bundles"] },
                      (old) =>
                        Array.isArray(old)
                          ? old.map((b) =>
                              b.bundle_code === entry.bundle_code
                                ? { ...b, location: null }
                                : b,
                            )
                          : old,
                    );
                    toast({ title: `Cleared location for ${entry.bundle_code}`, variant: "success" });
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
// Add single entry form
// ---------------------------------------------------------------------------

interface AddEntryFormProps {
  dbCodes: Set<string>;
  onSaved: (entry: LocationEntry) => void;
}

function AddEntryForm({ dbCodes, onSaved }: AddEntryFormProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);

  const trimCode = code.trim().toUpperCase();
  const trimLoc = location.trim().toUpperCase();
  const locValid = LOCATION_RE.test(trimLoc);
  const codeValid = trimCode.length > 0;
  const isPhantom = codeValid && !dbCodes.has(trimCode);

  const handleSave = async () => {
    if (busy || !codeValid || !locValid) return;
    setBusy(true);
    try {
      const entry = await upsertLocationEntry(trimCode, trimLoc);
      onSaved(entry);
      setCode("");
      setLocation("");
    } catch {
      toast({ title: "Failed to save", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="AV-0001"
            className={cn(
              "font-mono text-sm uppercase",
              isPhantom && "text-yellow-500",
            )}
            disabled={busy}
          />
          {isPhantom && (
            <p className="text-[10px] text-yellow-500">Not in database</p>
          )}
        </div>
        <Input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder="AV-01"
          className={cn(
            "w-28 text-center font-mono text-sm uppercase",
            trimLoc && !locValid && "border-destructive focus-visible:ring-destructive",
          )}
          disabled={busy}
        />
        <Button
          disabled={busy || !codeValid || !locValid}
          onClick={handleSave}
          className="shrink-0"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-entry row (edit location or clear)
// ---------------------------------------------------------------------------

interface EntryRowProps {
  entry: LocationEntry;
  inDb: boolean;
  canEdit: boolean;
  onSaved: (updated: LocationEntry) => void;
  onDeleted: () => void;
}

function EntryRow({ entry, inDb, canEdit, onSaved, onDeleted }: EntryRowProps) {
  const { toast } = useToast();
  const [value, setValue] = useState(entry.location);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setValue(entry.location);
  }, [entry.location]);

  const trimmed = value.trim().toUpperCase();
  const dirty = trimmed !== entry.location.toUpperCase();
  const valid = LOCATION_RE.test(trimmed);

  const handleSave = async () => {
    if (busy || !dirty || !valid) return;
    setBusy(true);
    try {
      const updated = await upsertLocationEntry(entry.bundle_code, trimmed);
      onSaved(updated);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1500);
    } catch {
      toast({ title: "Failed to save", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteLocationEntry(entry.bundle_code);
      onDeleted();
    } catch {
      toast({ title: "Failed to clear location", variant: "error" });
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate font-mono text-sm font-semibold",
            !inDb && "text-yellow-500",
          )}
          title={!inDb ? "Not in database" : undefined}
        >
          {entry.bundle_code}
          {!inDb && (
            <span className="ml-1.5 text-[10px] font-normal normal-case">
              (not in DB)
            </span>
          )}
        </p>
      </div>
      {canEdit ? (
        <>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleSave(); }
            }}
            placeholder="AV-01"
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
            {busy && dirty ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : justSaved ? (
              <Check className="h-4 w-4" />
            ) : (
              "Save"
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={handleDelete}
            className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="Clear location"
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <span className="font-mono text-sm font-semibold text-muted-foreground">
          {entry.location}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy codes button
// ---------------------------------------------------------------------------

function CopyCodesButton({ codes, location }: { codes: string[]; location: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = codes.map((c) => `${c} | ${location}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
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
// Bulk delete panel — paste codes, preview what will be cleared, confirm
// ---------------------------------------------------------------------------

interface BulkDeletePanelProps {
  existingCodes: Set<string>;
  onDeleted: (codes: string[]) => void;
}

function BulkDeletePanel({ existingCodes, onDeleted }: BulkDeletePanelProps) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parsed = text.trim()
    ? text
        .split("\n")
        .flatMap((line, i) => {
          const code = line.trim().toUpperCase();
          if (!code || code.startsWith("#")) return [];
          return [{ code, lineNum: i + 1, hasEntry: existingCodes.has(code) }];
        })
    : ([] as { code: string; lineNum: number; hasEntry: boolean }[]);

  // Deduplicate by code — keep first occurrence.
  const seen = new Set<string>();
  const deduped = parsed.filter(({ code }) => {
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  });

  const toDelete = deduped.filter((l) => l.hasEntry);
  const notFound = deduped.filter((l) => !l.hasEntry);

  const handleDelete = async () => {
    if (busy || toDelete.length === 0) return;
    setBusy(true);
    const codes = toDelete.map((l) => l.code);
    setConfirmOpen(false);
    try {
      const results = await Promise.allSettled(codes.map((c) => deleteLocationEntry(c)));
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = codes.filter((_, i) => results[i].status === "fulfilled");
      onDeleted(succeeded);
      if (failed === 0) {
        toast({
          title: `Cleared ${codes.length} location${codes.length === 1 ? "" : "s"}`,
          variant: "success",
        });
        setText("");
      } else {
        toast({
          title: `Cleared ${codes.length - failed} of ${codes.length}`,
          description: `${failed} failed`,
          variant: "warning",
        });
      }
    } catch {
      toast({ title: "Bulk delete failed", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        One bundle code per line. Codes with no location entry are ignored.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"AV-0001\nAVG-0023\nAV-0045"}
        rows={5}
        disabled={busy}
        className="font-mono text-sm"
      />

      {deduped.length > 0 && (
        <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs">
          {toDelete.length > 0 && (
            <p className="font-semibold text-destructive">
              {toDelete.length} entr{toDelete.length === 1 ? "y" : "ies"} will be cleared
            </p>
          )}
          {notFound.length > 0 && (
            <p className="text-muted-foreground">
              {notFound.length} code{notFound.length === 1 ? "" : "s"} have no location — will be skipped
            </p>
          )}
        </div>
      )}

      {toDelete.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {toDelete.slice(0, 8).map((l) => (
            <Badge
              key={l.code}
              variant="outline"
              className="border-destructive/40 font-mono text-xs text-destructive"
            >
              {l.code}
            </Badge>
          ))}
          {toDelete.length > 8 && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              +{toDelete.length - 8} more
            </Badge>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={busy || toDelete.length === 0}
          className="flex-1"
        >
          {busy ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</>
          ) : (
            <>Delete {toDelete.length > 0 ? toDelete.length : ""} Entr{toDelete.length === 1 ? "y" : "ies"}</>
          )}
        </Button>
        {text.trim() && (
          <Button variant="outline" size="sm" onClick={() => setText("")} disabled={busy}>
            Clear
          </Button>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(v) => !v && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {toDelete.length} location {toDelete.length === 1 ? "entry" : "entries"}?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This clears the rack assignment for the bundles below. The bundles themselves are not deleted.
            </p>
            <div className="max-h-[40vh] overflow-y-auto rounded-md border bg-muted/20 p-2">
              <div className="flex flex-wrap gap-1.5">
                {toDelete.map((l) => (
                  <span
                    key={l.code}
                    className="inline-flex items-center rounded-md border bg-card px-2 py-0.5 font-mono text-xs font-semibold"
                  >
                    {l.code}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              Delete {toDelete.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk assign panel — accepts any code, DB or phantom
// ---------------------------------------------------------------------------

interface ParsedLine {
  raw: string;
  lineNum: number;
  code?: string;
  location?: string;
  error?: string;
  isPhantom?: boolean;
}

function parseBulkText(text: string): ParsedLine[] {
  return text
    .split("\n")
    .map((raw, i) => {
      const lineNum = i + 1;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#")) return null;
      const parts = trimmed.split(/[\s,]+/, 2);
      if (parts.length < 2) {
        return { raw, lineNum, error: "Expected: BUNDLE_CODE LOCATION" };
      }
      const code = parts[0].toUpperCase();
      const location = parts[1].toUpperCase();
      if (!LOCATION_RE.test(location)) {
        return {
          raw, lineNum, code, location,
          error: `Invalid location "${location}" — use AV-01 or AVG-12`,
        };
      }
      return { raw, lineNum, code, location };
    })
    .filter(Boolean) as ParsedLine[];
}

interface BulkAssignPanelProps {
  onApplied: (saved: LocationEntry[]) => void;
}

function BulkAssignPanel({ onApplied }: BulkAssignPanelProps) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // We still fetch bundles here to show the phantom marker in preview.
  const bundlesQuery = useQuery({
    queryKey: ["bundles"],
    queryFn: () => fetchBundles({}),
    staleTime: 30_000,
  });
  const dbCodes = new Set((bundlesQuery.data ?? []).map((b: Bundle) => b.bundle_code));

  const parsed = text.trim() ? parseBulkText(text) : [];
  const valid = parsed
    .filter((l) => !l.error)
    .map((l) => ({ ...l, isPhantom: !dbCodes.has(l.code!) }));
  const errors = parsed.filter((l) => l.error);

  const handleApply = async () => {
    if (busy || valid.length === 0) return;
    setBusy(true);
    try {
      const result = await bulkUpsertLocationEntries(
        valid.map((l) => ({ bundle_code: l.code!, location: l.location! })),
      );
      onApplied(result.saved);
      const failed = result.errors.length;
      if (failed === 0) {
        toast({
          title: `Assigned ${result.saved.length} location${result.saved.length === 1 ? "" : "s"}`,
          variant: "success",
        });
        setText("");
      } else {
        toast({
          title: `${result.saved.length} assigned, ${failed} failed`,
          variant: "warning",
        });
      }
    } catch {
      toast({ title: "Bulk assign failed", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        One entry per line:{" "}
        <code className="font-mono">BUNDLE_CODE LOCATION</code> — e.g.{" "}
        <code className="font-mono">AV-0001 AV-01</code>.{" "}
        Codes not in the database are allowed and shown in{" "}
        <span className="font-semibold text-yellow-500">yellow</span>.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"AV-0001 AV-01\nAVG-0023 AVG-03\nAV-0045 AV-02"}
        rows={6}
        disabled={busy}
        className="font-mono text-sm"
      />

      {parsed.length > 0 && (
        <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs">
          {valid.length > 0 && (
            <p className="font-semibold text-success">
              {valid.length} valid assignment{valid.length === 1 ? "" : "s"}
              {valid.some((l) => l.isPhantom) && (
                <span className="ml-1 font-normal text-yellow-500">
                  ({valid.filter((l) => l.isPhantom).length} not in DB)
                </span>
              )}
            </p>
          )}
          {errors.map((l) => (
            <div key={l.lineNum} className="flex items-start gap-1.5 text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>Line {l.lineNum}: {l.error}</span>
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
          <Button variant="outline" size="sm" onClick={() => setText("")} disabled={busy}>
            Clear
          </Button>
        )}
      </div>

      {valid.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {valid.slice(0, 8).map((l) => (
            <Badge
              key={l.code}
              variant="outline"
              className={cn("font-mono text-xs", l.isPhantom && "border-yellow-500/50 text-yellow-500")}
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
