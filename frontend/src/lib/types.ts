export type Role = "Admin" | "Content Creators" | "Listing Executives" | "Developer" | string;

export interface User {
  id: number;
  username: string;
  role: Role;
  is_approved: number; // 1 = active, 0 = pending, -1 = rejected
}

export interface BundleItem {
  id?: number;
  gender: string;
  brand: string;
  article: string;
  number_of_pieces: number;
  gift_pcs: number;
  grade: string;
  size_variation: string;
  comments?: string | null;
}

export interface BundleImage {
  id: number;
  image_path: string;
}

export interface Bundle {
  id: number;
  bundle_code: string;
  bundle_name?: string | null;
  status: string;
  /** 0 = draft, 1 = posted. Togglable by Admin and Listing Executives. */
  posted: number;
  /** Physical warehouse location, e.g. "AV-01" / "AVG-12". Admin-set. */
  location?: string | null;
  created_at: string;
  items: BundleItem[];
  images: BundleImage[];
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  username: string;
  role: Role;
}

export interface UploadInitResponse {
  upload_id: string;
}

export type UploadJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface UploadJobStatusResponse {
  status: UploadJobStatus;
  progress: number; // 0..1
  error?: string | null;
  image_id?: number | null;
}
