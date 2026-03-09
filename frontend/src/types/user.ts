/**
 * User-related types for auth, membership, and usage tracking.
 */

/** Membership tier — determines monthly OCR page limits.
 * Now dynamic (stored in Firestore), but these are the built-in defaults. */
export type MemberTier = string;

/** Account approval status. */
export type AccountStatus = "pending" | "active" | "suspended";

/** Fallback human-readable tier labels (overridden by dynamic tiers from API). */
export const TIER_LABELS: Record<string, string> = {
  basic: "基本",
  sponsor: "贊助",
  premium: "特許",
  admin: "管理員",
};

/** Human-readable status labels. */
export const STATUS_LABELS: Record<AccountStatus, string> = {
  pending: "待審批",
  active: "活躍",
  suspended: "已停權",
};

/** User profile stored in Firestore (users/{uid}). */
export interface UserProfile {
  uid: string;
  email: string;
  display_name: string;
  salutation: string;       // 稱為
  whatsapp: string;
  tier: MemberTier;
  status: AccountStatus;
  group: string;            // default "個人", admin can assign e.g. "A組","B組"
  /** Year-month string e.g. "2026-02" */
  usage_month: string;
  /** OCR pages consumed this month */
  usage_pages: number;
  /** Cloud storage used (bytes) */
  storage_used_bytes?: number;
  created_at: string;       // ISO
  last_login: string;       // ISO
  notes: string;            // admin-editable
  photo_url: string;        // from Google
  /** Resolved feature flags from the user's tier (returned by GET /me). */
  tier_features?: Record<string, boolean>;
  /** Per-project size cap (MB), resolved from tier. -1 means unlimited. */
  project_size_mb?: number;
  /** Cloud storage quota (MB), resolved from tier. 0 = none, -1 = unlimited. */
  storage_quota_mb?: number;
}

/** Feature flags that can be toggled per tier.
 *  category: "toggle" = simple on/off, "quota" = has usage limits */
export const TIER_FEATURES = [
  { key: "ocr", label: "OCR 文字辨識", category: "toggle" as const },
  { key: "cloud_save", label: "雲端儲存專案", category: "toggle" as const },
  { key: "export_excel", label: "匯出 Excel", category: "toggle" as const },
  { key: "export_pdf", label: "匯出 PDF 頁面", category: "toggle" as const },
  { key: "templates", label: "範本管理", category: "toggle" as const },
  { key: "bq_ocr", label: "BQ OCR 提取", category: "toggle" as const },
  { key: "bq_export_page", label: "BQ 匯出頁面（瀏覽）", category: "toggle" as const },
  { key: "bq_export", label: "BQ 數據匯出（下載）", category: "toggle" as const },
  { key: "auto_backup", label: "自動備份工作階段", category: "toggle" as const },
  { key: "pdf_unlock", label: "PDF 解鎖", category: "toggle" as const },
  { key: "excel_unlock", label: "Excel 解鎖", category: "toggle" as const },
  { key: "pdf_search", label: "PDF 搜尋/擷取", category: "toggle" as const },
] as const;

export type TierFeatureKey = typeof TIER_FEATURES[number]["key"];

/** Minimal profile for the admin table. */
export type UserRow = Pick<
  UserProfile,
  | "uid"
  | "display_name"
  | "email"
  | "whatsapp"
  | "tier"
  | "status"
  | "group"
  | "usage_pages"
  | "usage_month"
  | "created_at"
  | "last_login"
  | "notes"
>;
