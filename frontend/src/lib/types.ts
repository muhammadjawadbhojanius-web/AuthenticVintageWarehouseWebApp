export type Role = "Admin" | "Content Creators" | "Listing Executives" | "Developer";

/** Numeric approval states stored in the DB. */
export const APPROVAL = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: -1,
} as const;
export type ApprovalState = (typeof APPROVAL)[keyof typeof APPROVAL];

export interface User {
  id: number;
  username: string;
  role: Role;
  is_approved: ApprovalState;
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

export type BundleStatus = "pending" | "active" | "archived";

/** 0 = draft, 1 = posted, 2 = sold */
export type PostedStatus = 0 | 1 | 2;

export interface Bundle {
  id: number;
  bundle_code: string;
  bundle_name?: string | null;
  status: BundleStatus | string; // `| string` allows forward-compat with new server values
  /** 0 = draft, 1 = posted, 2 = sold. Togglable by Admin and Listing Executives. */
  posted: PostedStatus;
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
