"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  PackageSearch,
  RefreshCw,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Card } from "@/components/ui/card";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useAuth } from "@/contexts/auth-context";
import { fetchStockReport, type StockReport } from "@/lib/queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Stock Report
//
// Three views over all non-sold (posted != 2) bundles:
//   By Brand · By Article · Combined (Brand × Article)
//
// Items whose brand / article fields contain commas are split by the
// backend and their pieces are divided equally across the split values,
// so totals in the table can be fractional. The grand totals in the
// summary row are raw (no splitting / rounding).
//
// Developer-only entry point — gated both on the /admin hub card and
// on this page's render.
// ---------------------------------------------------------------------------

type Tab = "brand" | "article" | "combined";
type SortKey = "key" | "pieces" | "gift" | "total" | "bundle_count";
type SortDir = "asc" | "desc";

interface Row {
  key: string;
  // For combined view we pack "brand · article" into key for sort +
  // display, but also keep the originals in case we want a two-column
  // layout later.
  primary: string;
  secondary?: string;
  pieces: number;
  gift: number;
  total: number;
  bundle_count: number;
}

function buildRows(data: StockReport, tab: Tab): Row[] {
  if (tab === "brand") {
    return data.by_brand.map((r) => ({
      key: r.brand,
      primary: r.brand,
      pieces: r.pieces,
      gift: r.gift,
      total: r.total,
      bundle_count: r.bundle_count,
    }));
  }
  if (tab === "article") {
    return data.by_article.map((r) => ({
      key: r.article,
      primary: r.article,
      pieces: r.pieces,
      gift: r.gift,
      total: r.total,
      bundle_count: r.bundle_count,
    }));
  }
  return data.combined.map((r) => ({
    key: `${r.brand}|${r.article}`,
    primary: r.brand,
    secondary: r.article,
    pieces: r.pieces,
    gift: r.gift,
    total: r.total,
    bundle_count: r.bundle_count,
  }));
}

function formatNumber(n: number): string {
  // Drop trailing zeros on fractional values.
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export default function StockReportPage() {
  const { ready } = useAuthGuard();
  const router = useRouter();
  const { isDeveloper } = useAuth();

  // Belt-and-braces: page itself bounces non-developers back to /admin.
  useEffect(() => {
    if (ready && !isDeveloper) router.replace("/admin");
  }, [ready, isDeveloper, router]);

  const [tab, setTab] = useState<Tab>("brand");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("pieces");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const stockQuery = useQuery({
    queryKey: ["stock-report"],
    queryFn: fetchStockReport,
    enabled: ready && isDeveloper,
  });

  const rows = useMemo(() => {
    if (!stockQuery.data) return [] as Row[];
    const all = buildRows(stockQuery.data, tab);
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? all.filter(
          (r) =>
            r.primary.toLowerCase().includes(needle) ||
            (r.secondary?.toLowerCase().includes(needle) ?? false),
        )
      : all;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortKey === "key" ? a.primary : (a[sortKey] as number);
      const bv = sortKey === "key" ? b.primary : (b[sortKey] as number);
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  }, [stockQuery.data, tab, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "key" ? "asc" : "desc");
    }
  };

  if (!ready || !isDeveloper) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const totals = stockQuery.data?.totals;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="mx-auto max-w-4xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <PackageSearch className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Stock Report</h1>
          <span className="ml-2 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
            Dev
          </span>
          <Button
            variant="outline"
            size="icon"
            className="ml-auto"
            disabled={stockQuery.isFetching}
            onClick={() => stockQuery.refetch()}
            title="Refresh"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                stockQuery.isFetching && "animate-spin",
              )}
            />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Aggregated across every bundle that isn&rsquo;t sold (draft +
          posted). Items whose <span className="font-mono">brand</span> or{" "}
          <span className="font-mono">article</span> fields contain commas
          are split and their pieces are divided equally across the split
          values.
        </p>

        {/* Summary cards — raw totals from the backend, no splitting. */}
        {totals && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryStat label="Bundles" value={totals.bundles} />
            <SummaryStat label="Sellable" value={totals.pieces} />
            <SummaryStat label="Gift" value={totals.gift} />
            <SummaryStat label="Total pcs" value={totals.total} />
          </div>
        )}

        {/* Tabs — segmented buttons matching the filter popover + theme toggle */}
        <div className="grid grid-cols-3 gap-2">
          <TabButton active={tab === "brand"} onClick={() => setTab("brand")}>
            By Brand
          </TabButton>
          <TabButton active={tab === "article"} onClick={() => setTab("article")}>
            By Article
          </TabButton>
          <TabButton active={tab === "combined"} onClick={() => setTab("combined")}>
            Brand × Article
          </TabButton>
        </div>

        {/* Search box for the current tab */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={
              tab === "combined"
                ? "Search brand or article…"
                : tab === "brand"
                  ? "Search brand…"
                  : "Search article…"
            }
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {stockQuery.isLoading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}

        {stockQuery.isError && (
          <Card className="p-4 text-sm text-destructive">
            Failed to load stock report. Try refreshing.
          </Card>
        )}

        {stockQuery.isSuccess && rows.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            {search ? "No matches for that search." : "No stock to report."}
          </Card>
        )}

        {stockQuery.isSuccess && rows.length > 0 && (
          <Card className="overflow-hidden">
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
                  <tr className="text-left">
                    <ThButton
                      label={tab === "combined" ? "Brand" : tab === "brand" ? "Brand" : "Article"}
                      sortKey="key"
                      active={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      wide
                    />
                    {tab === "combined" && (
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Article
                      </th>
                    )}
                    <ThButton
                      label="Sellable"
                      sortKey="pieces"
                      active={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                    />
                    <ThButton
                      label="Gift"
                      sortKey="gift"
                      active={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                    />
                    <ThButton
                      label="Total"
                      sortKey="total"
                      active={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                    />
                    <ThButton
                      label="Bundles"
                      sortKey="bundle_count"
                      active={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.key}
                      className="border-t border-border/60 hover:bg-accent/30"
                    >
                      <td className="px-3 py-2 font-medium">{r.primary}</td>
                      {tab === "combined" && (
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.secondary}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(r.pieces)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatNumber(r.gift)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatNumber(r.total)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {r.bundle_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {totals && rows.length > 0 && (
                  <tfoot className="sticky bottom-0 z-10 bg-muted/50 backdrop-blur">
                    <tr className="border-t font-semibold">
                      <td className="px-3 py-2">
                        {search ? "Filtered rows" : "All rows"}
                      </td>
                      {tab === "combined" && <td />}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(rows.reduce((s, r) => s + r.pieces, 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(rows.reduce((s, r) => s + r.gift, 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(rows.reduce((s, r) => s + r.total, 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {rows.reduce((s, r) => s + r.bundle_count, 0)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums">
        {formatNumber(value)}
      </p>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-input hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function ThButton({
  label,
  sortKey,
  active,
  dir,
  onToggle,
  wide,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onToggle: (k: SortKey) => void;
  wide?: boolean;
}) {
  const isActive = active === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        wide ? "text-left" : "text-right",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors",
          wide ? "" : "justify-end w-full",
          isActive ? "text-foreground" : "hover:text-foreground",
        )}
      >
        {label}
        {isActive ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}
