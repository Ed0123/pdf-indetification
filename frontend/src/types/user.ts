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
  created_at: string;       // ISO
  last_login: string;       // ISO
  notes: string;            // admin-editable
  photo_url: string;        // from Google
}

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
