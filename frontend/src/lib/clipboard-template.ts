/**
 * Renders a bundle into a clipboard-friendly string using a template that
 * lives on the backend at `backend/app/templates/clipboard.json` (bind-
 * mounted into the container so the user can edit it without rebuilding).
 *
 * The template has four parts:
 *   - header           string with {placeholder} tokens
 *   - item             string applied per item
 *   - item_separator   joins the rendered items
 *   - footer           appended at the end
 */

import { api } from "./api";
import type { Bundle, BundleItem } from "./types";

export interface ClipboardTemplate {
  header: string;
  item: string;
  item_separator: string;
  footer: string;
}

let cachedTemplate: ClipboardTemplate | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5_000; // refetch at most every 5s so edits land fast

/**
 * Fetches the template from `/templates/clipboard`. Light caching so a
 * single click doesn't trigger N requests, but short enough that template
 * edits show up almost immediately on subsequent copies.
 */
export async function fetchClipboardTemplate(): Promise<ClipboardTemplate> {
  const now = Date.now();
  if (cachedTemplate && now - cachedAt < CACHE_TTL_MS) {
    return cachedTemplate;
  }
  const res = await api().get<ClipboardTemplate>("/templates/clipboard");
  cachedTemplate = {
    header: res.data.header ?? "",
    item: res.data.item ?? "",
    item_separator: res.data.item_separator ?? "\n",
    footer: res.data.footer ?? "",
  };
  cachedAt = now;
  return cachedTemplate;
}

/** Forces the next call to refetch from the server. */
export function invalidateClipboardTemplate() {
  cachedTemplate = null;
  cachedAt = 0;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    const dt = new Date(iso);
    return dt.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return String(iso);
  }
}

/**
 * Replaces every `{key}` token in `template` with `vars[key]`. Missing
 * keys become an empty string so the user can leave optional placeholders
 * in the template without producing literal `{undefined}` text.
 */
function substitute(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const v = vars[key];
    if (v == null) return "";
    return String(v);
  });
}

/**
 * Renders a Bundle into the final clipboard string using the given
 * template. Pure function — no side effects, no network.
 */
export function renderBundleClipboard(template: ClipboardTemplate, bundle: Bundle): string {
  const total_pieces = (bundle.items ?? []).reduce((acc, it) => acc + (it.number_of_pieces || 0), 0);

  const headerVars = {
    bundle_code: bundle.bundle_code,
    bundle_name: bundle.bundle_name ?? "",
    status: bundle.status,
    created_at: formatDate(bundle.created_at),
    item_count: bundle.items?.length ?? 0,
    image_count: bundle.images?.length ?? 0,
    total_pieces,
  };

  const renderedHeader = substitute(template.header, headerVars);

  const renderedItems = (bundle.items ?? []).map((it: BundleItem, i: number) =>
    substitute(template.item, {
      n: i + 1,
      gender: it.gender,
      brand: it.brand,
      article: it.article,
      number_of_pieces: it.number_of_pieces,
      gift_pcs: it.gift_pcs,
      grade: it.grade,
      size_variation: it.size_variation,
      comments: it.comments || "No Additional Comment",
    })
  );

  const itemsBlock = renderedItems.join(template.item_separator);
  const renderedFooter = substitute(template.footer, headerVars);

  // Glue: header → items → footer with single newlines between non-empty parts
  return [renderedHeader, itemsBlock, renderedFooter]
    .filter((part) => part.length > 0)
    .join("\n");
}

/**
 * Convenience: fetch template, render bundle, write to clipboard. Throws
 * on any failure (no clipboard permission, network error, malformed
 * template). Callers should toast.
 */
export async function copyBundleToClipboard(bundle: Bundle, template?: ClipboardTemplate): Promise<string> {
  const finalTemplate = template || await fetchClipboardTemplate();
  const text = renderBundleClipboard(finalTemplate, bundle);
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback for older browsers / non-secure contexts (e.g. plain HTTP
    // local network where Clipboard API may be blocked).
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }
  return text;
}
