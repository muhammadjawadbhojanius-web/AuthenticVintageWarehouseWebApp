"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  Trash2,
  Loader2,
  AlertTriangle,
  GitMerge,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useToast } from "@/components/toaster";
import {
  fetchAllBrands,
  fetchAllArticles,
  bulkCreateBrands,
  bulkCreateArticles,
  approveBrand,
  approveArticle,
  deleteBrand,
  deleteArticle,
  mergeBrand,
  mergeArticle,
  verifyBrands,
  verifyArticles,
  type CatalogItem,
} from "@/lib/queries";

type Tab = "brands" | "articles";

export default function AdminCatalogPage() {
  const { ready } = useAuthGuard({ requireRole: "Admin" });
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("brands");
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  // Bulk-add state
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Merge dialog state
  const [mergeSource, setMergeSource] = useState<CatalogItem | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");
  const [mergeBusy, setMergeBusy] = useState(false);

  // Verify state
  const [verifyBusy, setVerifyBusy] = useState(false);

  const brandsQuery = useQuery({
    queryKey: ["catalog", "brands", "all"],
    queryFn: fetchAllBrands,
    enabled: ready,
  });

  const articlesQuery = useQuery({
    queryKey: ["catalog", "articles", "all"],
    queryFn: fetchAllArticles,
    enabled: ready,
  });

  const activeQuery = tab === "brands" ? brandsQuery : articlesQuery;
  const items: CatalogItem[] = activeQuery.data ?? [];
  const pending = items.filter((i) => i.is_approved === 0);
  const approved = items.filter((i) => i.is_approved === 1);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["catalog", "brands"] });
    queryClient.invalidateQueries({ queryKey: ["catalog", "articles"] });
  }

  function setBusy(id: number, on: boolean) {
    setBusyIds((prev) => {
      const s = new Set(prev);
      if (on) s.add(id); else s.delete(id);
      return s;
    });
  }

  async function handleApprove(item: CatalogItem) {
    setBusy(item.id, true);
    try {
      if (tab === "brands") await approveBrand(item.id);
      else await approveArticle(item.id);
      invalidate();
      toast({ title: `"${item.name}" approved`, variant: "success" });
    } catch {
      toast({ title: "Failed to approve", variant: "error" });
    } finally {
      setBusy(item.id, false);
    }
  }

  async function handleDelete(item: CatalogItem) {
    setBusy(item.id, true);
    try {
      if (tab === "brands") await deleteBrand(item.id);
      else await deleteArticle(item.id);
      invalidate();
      toast({ title: `"${item.name}" deleted`, variant: "success" });
    } catch {
      toast({ title: "Failed to delete", variant: "error" });
    } finally {
      setBusy(item.id, false);
    }
  }

  async function handleBulkAdd() {
    const names = bulkText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    setBulkBusy(true);
    try {
      if (tab === "brands") await bulkCreateBrands(names);
      else await bulkCreateArticles(names);
      invalidate();
      setBulkText("");
      toast({
        title: `${names.length} ${tab === "brands" ? "brand" : "article"}${names.length === 1 ? "" : "s"} added`,
        variant: "success",
      });
    } catch {
      toast({ title: "Bulk add failed", variant: "error" });
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleMerge() {
    if (!mergeSource || !mergeTargetId) return;
    setMergeBusy(true);
    try {
      if (tab === "brands") await mergeBrand(mergeSource.id, Number(mergeTargetId));
      else await mergeArticle(mergeSource.id, Number(mergeTargetId));
      invalidate();
      // Also invalidate bundle queries so the item form refreshes
      queryClient.invalidateQueries({ queryKey: ["bundles"] });
      setMergeSource(null);
      setMergeTargetId("");
      toast({ title: "Merged — all bundle items updated", variant: "success" });
    } catch {
      toast({ title: "Merge failed", variant: "error" });
    } finally {
      setMergeBusy(false);
    }
  }

  async function handleVerify() {
    setVerifyBusy(true);
    try {
      const added = tab === "brands" ? await verifyBrands() : await verifyArticles();
      invalidate();
      if (added.length === 0) {
        toast({ title: "All good — no unknown entries found", variant: "success" });
      } else {
        toast({
          title: `${added.length} unknown ${tab === "brands" ? "brand" : "article"}${added.length === 1 ? "" : "s"} added as pending`,
          variant: "warning",
        });
      }
    } catch {
      toast({ title: "Verify failed", variant: "error" });
    } finally {
      setVerifyBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Options for the merge target select: all approved items except the source itself
  const mergeOptions = approved.filter((a) => a.id !== mergeSource?.id);

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="font-semibold">Catalog Management</h1>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={() => activeQuery.refetch()}
        >
          <RefreshCw className={`h-4 w-4 ${activeQuery.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {/* Tab switcher */}
        <div className="flex gap-2">
          {(["brands", "articles"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setBulkText("");
                setMergeSource(null);
                setMergeTargetId("");
              }}
              className={`flex-1 rounded-md border py-2 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Bulk add */}
        <Card>
          <CardContent className="space-y-3 pt-5">
            <div>
              <h2 className="text-sm font-semibold">Add {tab === "brands" ? "Brands" : "Articles"}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                One per line or comma-separated. All entries are auto-approved.
              </p>
            </div>
            <Textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={`Nike\nAdidas\nPuma\n…`}
              rows={5}
              disabled={bulkBusy}
            />
            <Button
              onClick={handleBulkAdd}
              disabled={bulkBusy || !bulkText.trim()}
              className="w-full"
            >
              {bulkBusy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Adding…</>
              ) : (
                `Add ${bulkText.trim().split(/[\n,]+/).filter(Boolean).length || 0} entries`
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Verify */}
        <Card>
          <CardContent className="space-y-2 pt-5">
            <div>
              <h2 className="text-sm font-semibold">Verify {tab === "brands" ? "Brands" : "Articles"}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Scan all bundle items for {tab === "brands" ? "brands" : "articles"} that aren&rsquo;t in the catalog yet and add them as pending.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleVerify}
              disabled={verifyBusy}
              className="w-full"
            >
              {verifyBusy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Scanning…</>
              ) : (
                <><ShieldCheck className="h-4 w-4" /> Verify {tab === "brands" ? "Brands" : "Articles"}</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Pending section */}
        {pending.length > 0 && (
          <Card>
            <CardContent className="space-y-2 pt-5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold">Pending Approval ({pending.length})</h2>
              </div>
              {pending.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  busy={busyIds.has(item.id)}
                  onApprove={() => handleApprove(item)}
                  onDelete={() => handleDelete(item)}
                  onMerge={approved.length > 0 ? () => {
                    setMergeSource(item);
                    setMergeTargetId("");
                  } : undefined}
                />
              ))}
            </CardContent>
          </Card>
        )}

        {/* Approved section */}
        <Card>
          <CardContent className="space-y-2 pt-5">
            <h2 className="text-sm font-semibold">
              Approved {tab === "brands" ? "Brands" : "Articles"} ({approved.length})
            </h2>
            {approved.length === 0 && (
              <p className="text-sm text-muted-foreground">None yet.</p>
            )}
            {approved.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                busy={busyIds.has(item.id)}
                onDelete={() => handleDelete(item)}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Merge dialog */}
      <Dialog
        open={!!mergeSource}
        onOpenChange={(open) => {
          if (!open) { setMergeSource(null); setMergeTargetId(""); }
        }}
      >
        <DialogContent onClose={() => { setMergeSource(null); setMergeTargetId(""); }}>
          <DialogHeader>
            <DialogTitle>Merge into approved {tab === "brands" ? "brand" : "article"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              All bundle items using{" "}
              <span className="font-semibold text-foreground">&ldquo;{mergeSource?.name}&rdquo;</span>{" "}
              will be updated to the selected target. The entry{" "}
              <span className="font-semibold text-foreground">&ldquo;{mergeSource?.name}&rdquo;</span>{" "}
              will then be deleted.
            </p>
            <Select
              value={mergeTargetId}
              onChange={(e) => setMergeTargetId(e.target.value)}
              disabled={mergeBusy}
            >
              <option value="">Select target…</option>
              {mergeOptions.map((opt) => (
                <option key={opt.id} value={String(opt.id)}>
                  {opt.name}
                </option>
              ))}
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setMergeSource(null); setMergeTargetId(""); }}
              disabled={mergeBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={mergeBusy || !mergeTargetId}
            >
              {mergeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Merge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemRow({
  item,
  busy,
  onApprove,
  onDelete,
  onMerge,
}: {
  item: CatalogItem;
  busy: boolean;
  onApprove?: () => void;
  onDelete: () => void;
  onMerge?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">{item.name}</span>
        {item.is_approved === 0 && (
          <Badge variant="outline" className="ml-2 border-amber-400 text-amber-500 text-xs">
            Pending
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        {onMerge && (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={onMerge}
            title="Merge into approved"
          >
            <GitMerge className="h-4 w-4 text-blue-500" />
          </Button>
        )}
        {onApprove && (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={onApprove}
            title="Approve"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          onClick={onDelete}
          title="Delete"
        >
          {busy && !onApprove ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 text-destructive" />
          )}
        </Button>
      </div>
    </div>
  );
}
