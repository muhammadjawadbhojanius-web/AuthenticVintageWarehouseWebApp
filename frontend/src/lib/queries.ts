import { api } from "./api";
import type { Bundle, User } from "./types";

// ---------------------------------------------------------------------------
// Structured error shapes returned by the backend.
// ---------------------------------------------------------------------------

export interface BundleCodeExistsCreateError {
  code: "bundle_code_exists";
  message: string;
  bundle_code: string;
  bundle_name: string | null;
  item_count: number;
  image_count: number;
}

export interface BundleCodeExistsUpdateError {
  code: "bundle_code_exists";
  message: string;
  old_code: string;
  new_code: string;
  existing_bundle_code: string;
  existing_bundle_name: string | null;
  existing_item_count: number;
  existing_image_count: number;
}

/**
 * Returns the structured `detail` object when the server responds with a
 * 409 Conflict. Returns null for anything else, so callers can default to
 * their existing generic error path.
 */
export function extractConflictDetail<T = unknown>(err: unknown): T | null {
  const e = err as {
    response?: { status?: number; data?: { detail?: unknown } };
  };
  if (e?.response?.status !== 409) return null;
  const detail = e.response.data?.detail;
  if (!detail || typeof detail !== "object") return null;
  return detail as T;
}

// Bundles

export interface BundleListFilters {
  search?: string;
  /** 0 = draft, 1 = posted, 2 = sold. Leave undefined for "all". */
  posted?: number;
  /** Bundle-code prefix like "AV" or "AVG". Leave undefined for "all". */
  prefix?: string;
  /** true = only bundles with media, false = only without. Leave undefined for "all". */
  has_media?: boolean;
}

export async function fetchBundles(
  filters: BundleListFilters | string | undefined = undefined,
): Promise<Bundle[]> {
  // Preserve the old string-only signature for existing callers.
  const f: BundleListFilters =
    typeof filters === "string" ? { search: filters } : filters ?? {};
  const params = new URLSearchParams();
  if (f.search) params.append("search", f.search);
  if (f.posted !== undefined) params.append("posted", String(f.posted));
  if (f.prefix) params.append("prefix", f.prefix);
  if (f.has_media !== undefined) params.append("has_media", String(f.has_media));
  const qs = params.toString();
  const url = qs ? `/bundles/?${qs}` : "/bundles/";
  const res = await api().get<Bundle[]>(url);
  // If the backend is misconfigured (wrong base URL pointed at an HTML
  // page, a proxy returning an error doc, etc.) axios hands us the raw
  // body as a string. Reject anything that isn't an array here so React
  // Query enters isError cleanly instead of letting a string leak into
  // components that call .map on it.
  if (!Array.isArray(res.data)) {
    throw new Error("Unexpected response from /bundles — not a list");
  }
  return res.data;
}

export async function fetchBundle(code: string): Promise<Bundle> {
  const res = await api().get<Bundle>(`/bundles/${encodeURIComponent(code)}`);
  return res.data;
}

export async function createBundle(
  bundleCode: string,
  bundleName?: string,
  opts: { overwrite?: boolean } = {},
) {
  const url = opts.overwrite ? "/bundles/?overwrite=true" : "/bundles/";
  const res = await api().post<Bundle>(url, {
    bundle_code: bundleCode,
    bundle_name: bundleName || null,
  });
  return res.data;
}

/**
 * Atomically swap the codes (and uploads folders + file names + DB paths)
 * of two existing bundles. Used when the admin hits a collision while
 * editing a code and opts to swap instead of cancel.
 */
export async function swapBundles(codeA: string, codeB: string): Promise<Bundle[]> {
  const res = await api().post<Bundle[]>(
    `/bundles/${encodeURIComponent(codeA)}/swap/${encodeURIComponent(codeB)}`,
  );
  return res.data;
}

export async function deleteBundle(bundleCode: string) {
  await api().delete(`/bundles/${encodeURIComponent(bundleCode)}`);
}

export async function updateBundleStatus(bundleCode: string, status: string) {
  await api().patch(`/bundles/${encodeURIComponent(bundleCode)}/status`, { status });
}

export async function updateBundlePosted(bundleCode: string, posted: number) {
  // posted: 0 = draft, 1 = posted, 2 = sold
  await api().patch(`/bundles/${encodeURIComponent(bundleCode)}/posted`, { posted });
}

export async function updateBundle(
  oldCode: string,
  update: { bundle_code?: string; bundle_name?: string },
) {
  await api().patch(`/bundles/${encodeURIComponent(oldCode)}`, update);
}

export async function addBundleItem(bundleCode: string, item: {
  gender: string;
  brand: string;
  article: string;
  number_of_pieces: number;
  gift_pcs: number;
  grade: string;
  size_variation: string;
  comments?: string | null;
}) {
  await api().post(`/bundles/${encodeURIComponent(bundleCode)}/items`, item);
}

export async function deleteBundleItem(bundleCode: string, itemId: number) {
  await api().delete(`/bundles/${encodeURIComponent(bundleCode)}/items/${itemId}`);
}

export async function updateBundleItem(
  bundleCode: string,
  itemId: number,
  item: {
    gender: string;
    brand: string;
    article: string;
    number_of_pieces: number;
    gift_pcs: number;
    grade: string;
    size_variation: string;
    comments?: string | null;
  }
) {
  await api().patch(
    `/bundles/${encodeURIComponent(bundleCode)}/items/${itemId}`,
    item
  );
}

export async function deleteBundleImage(bundleCode: string, imageId: number) {
  await api().delete(`/bundles/${encodeURIComponent(bundleCode)}/images/${imageId}`);
}

// Users
export async function fetchUsers(): Promise<User[]> {
  const res = await api().get<User[]>("/users/");
  if (!Array.isArray(res.data)) {
    throw new Error("Unexpected response from /users — not a list");
  }
  return res.data;
}

export async function approveUser(userId: number, role: string) {
  await api().patch(`/users/${userId}/approve`, { role });
}

export async function rejectUser(userId: number) {
  await api().patch(`/users/${userId}/reject`, { role: "" });
}

export async function changeUserRole(userId: number, role: string) {
  await api().patch(`/users/${userId}/role`, { role });
}

export async function deleteUser(userId: number) {
  await api().delete(`/users/${userId}`);
}

/**
 * Self-service password reset. No auth required (the user is logged out).
 * Server rejects this for Admin accounts and moves the user back to pending
 * approval after a successful reset.
 */
export async function resetPassword(username: string, password: string) {
  await api().post(`/users/reset-password`, { username, password });
}

// ---------------------------------------------------------------------------
// Stock report — developer-only in the UI, backend endpoint is unguarded
// (every routes here is; auth is advisory per CLAUDE.md).
// Bundles with posted=2 (sold) are excluded from the aggregation.
// ---------------------------------------------------------------------------

export interface StockRowBrand {
  brand: string;
  pieces: number;
  gift: number;
  total: number;
  bundle_count: number;
  bundle_codes: string[];
}
export interface StockRowArticle {
  article: string;
  pieces: number;
  gift: number;
  total: number;
  bundle_count: number;
  bundle_codes: string[];
}
export interface StockRowCombined {
  brand: string;
  article: string;
  pieces: number;
  gift: number;
  total: number;
  bundle_count: number;
  bundle_codes: string[];
}
export interface StockReport {
  by_brand: StockRowBrand[];
  by_article: StockRowArticle[];
  combined: StockRowCombined[];
  totals: { bundles: number; pieces: number; gift: number; total: number };
}

export async function fetchStockReport(
  prefix?: "AV" | "AVG",
): Promise<StockReport> {
  const res = await api().get<StockReport>("/bundles/stock", {
    params: prefix ? { prefix } : undefined,
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// Bulk-by-list validation — checks pasted codes against the DB before any
// destructive action runs. Server uppercases + dedupes server-side, so the
// returned `valid` and `missing` arrays are normalized.
// ---------------------------------------------------------------------------

export interface BundleCodesValidation {
  valid: string[];
  missing: string[];
}

export async function validateBundleCodes(
  codes: string[],
): Promise<BundleCodesValidation> {
  const res = await api().post<BundleCodesValidation>(
    "/bundles/validate-codes",
    { codes },
  );
  return res.data;
}

// ---------------------------------------------------------------------------
// Cancel an in-flight or already-finalized chunked upload. Idempotent on
// the server; safe to call even if the job has already completed (the
// server pulls the resulting BundleImage row + file in that case).
// ---------------------------------------------------------------------------

export async function cancelUpload(
  bundleCode: string,
  uploadId: string,
): Promise<void> {
  await api().post(
    `/bundles/${encodeURIComponent(bundleCode)}/uploads/${encodeURIComponent(uploadId)}/cancel`,
  );
}

// ---------------------------------------------------------------------------
// Catalog — brands and articles
// ---------------------------------------------------------------------------

export interface CatalogItem {
  id: number;
  name: string;
  is_approved: number;
  created_at: string;
}

export async function fetchApprovedBrands(): Promise<CatalogItem[]> {
  const res = await api().get<CatalogItem[]>("/catalog/brands");
  return res.data;
}

export async function fetchAllBrands(): Promise<CatalogItem[]> {
  const res = await api().get<CatalogItem[]>("/catalog/brands/all");
  return res.data;
}

export async function createBrandPending(name: string): Promise<CatalogItem> {
  const res = await api().post<CatalogItem>("/catalog/brands", { name });
  return res.data;
}

export async function bulkCreateBrands(names: string[]): Promise<CatalogItem[]> {
  const res = await api().post<CatalogItem[]>("/catalog/brands/bulk", { names });
  return res.data;
}

export async function approveBrand(id: number): Promise<CatalogItem> {
  const res = await api().patch<CatalogItem>(`/catalog/brands/${id}/approve`);
  return res.data;
}

export async function deleteBrand(id: number): Promise<void> {
  await api().delete(`/catalog/brands/${id}`);
}

export async function fetchApprovedArticles(): Promise<CatalogItem[]> {
  const res = await api().get<CatalogItem[]>("/catalog/articles");
  return res.data;
}

export async function fetchAllArticles(): Promise<CatalogItem[]> {
  const res = await api().get<CatalogItem[]>("/catalog/articles/all");
  return res.data;
}

export async function createArticlePending(name: string): Promise<CatalogItem> {
  const res = await api().post<CatalogItem>("/catalog/articles", { name });
  return res.data;
}

export async function bulkCreateArticles(names: string[]): Promise<CatalogItem[]> {
  const res = await api().post<CatalogItem[]>("/catalog/articles/bulk", { names });
  return res.data;
}

export async function approveArticle(id: number): Promise<CatalogItem> {
  const res = await api().patch<CatalogItem>(`/catalog/articles/${id}/approve`);
  return res.data;
}

export async function deleteArticle(id: number): Promise<void> {
  await api().delete(`/catalog/articles/${id}`);
}

export async function verifyBrands(): Promise<CatalogItem[]> {
  const res = await api().post<CatalogItem[]>("/catalog/brands/verify");
  return res.data;
}

export async function verifyArticles(): Promise<CatalogItem[]> {
  const res = await api().post<CatalogItem[]>("/catalog/articles/verify");
  return res.data;
}

export async function mergeBrand(sourceId: number, targetId: number): Promise<CatalogItem> {
  const res = await api().patch<CatalogItem>(`/catalog/brands/${sourceId}/merge/${targetId}`);
  return res.data;
}

export async function mergeArticle(sourceId: number, targetId: number): Promise<CatalogItem> {
  const res = await api().patch<CatalogItem>(`/catalog/articles/${sourceId}/merge/${targetId}`);
  return res.data;
}

// Health
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await api().get("/health", { timeout: 4000 });
    return res.status === 200;
  } catch {
    return false;
  }
}
