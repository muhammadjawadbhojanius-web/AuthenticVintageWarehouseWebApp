import { api } from "./api";
import type { Bundle, User } from "./types";

// Bundles
export async function fetchBundles(search?: string): Promise<Bundle[]> {
  const url = search ? `/bundles/?search=${encodeURIComponent(search)}` : "/bundles/";
  const res = await api().get<Bundle[]>(url);
  return res.data;
}

export async function fetchBundle(code: string): Promise<Bundle> {
  const res = await api().get<Bundle>(`/bundles/${encodeURIComponent(code)}`);
  return res.data;
}

export async function createBundle(bundleCode: string, bundleName?: string) {
  const res = await api().post<Bundle>("/bundles/", {
    bundle_code: bundleCode,
    bundle_name: bundleName || null,
  });
  return res.data;
}

export async function deleteBundle(bundleCode: string) {
  await api().delete(`/bundles/${encodeURIComponent(bundleCode)}`);
}

export async function updateBundleStatus(bundleCode: string, status: string) {
  await api().patch(`/bundles/${encodeURIComponent(bundleCode)}/status`, { status });
}

export async function updateBundleCode(oldCode: string, newCode: string) {
  await api().patch(`/bundles/${encodeURIComponent(oldCode)}`, { bundle_code: newCode });
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

// Health
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await api().get("/health", { timeout: 4000 });
    return res.status === 200;
  } catch {
    return false;
  }
}
