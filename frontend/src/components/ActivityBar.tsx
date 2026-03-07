/**
 * ActivityBar — vertical module navigation sidebar.
 *
 * Modules are grouped and the order has been adjusted:
 * 1) Templates
 * 2) Page View, Excel Export, PDF Export
 * 3) BQ OCR and BQ Export
 *
 * A thin separator line is drawn between the groups. Access tiers and collapse
 * toggle behavior remain unchanged.
 */
import React from "react";

export type ModuleId = 
  | "home"
  | "singlepage"
  | "bq_ocr"
  | "bq_export"
  | "templates"
  | "exportexcel"
  | "exportpdf";

/**
 * Modules are grouped into logical clusters; separators shown between groups.
 * `group` is a simple number that defines ordering and when to draw dividers.
 */
interface ModuleConfig {
  id: ModuleId;
  icon: string;
  label: string;
  shortLabel: string;
  description: string;
  tier?: string;     // Required tier for access (legacy fallback)
  feature?: string;  // Feature flag key checked against tier_features
  group?: number;    // grouping key for visual separators
}

const MODULES: ModuleConfig[] = [
  // Home dashboard appears first for post-login context and alerts.
  { id: "home", icon: "🏠", label: "Home", shortLabel: "Home", description: "System updates, quota, and access overview", group: 0 },

  // Template management stands alone in its own group (1)
  { id: "templates", icon: "📝", label: "Templates", shortLabel: "Tmpl", description: "Manage extraction templates", group: 1 },

  // Main editing and export tools share a second group (2)
  { id: "singlepage", icon: "📄", label: "Page View", shortLabel: "Page", description: "View and edit data for each page", group: 2 },
  { id: "exportexcel", icon: "📗", label: "Excel Export", shortLabel: "Excel", description: "Export data to Excel", group: 2 },
  { id: "exportpdf", icon: "📕", label: "PDF Export", shortLabel: "PDF", description: "Export selected PDF pages", group: 2 },

  // BQ tools are a sponsor‑tier group (3)
  { id: "bq_ocr", icon: "📋", label: "BQ OCR", shortLabel: "BQ", description: "Extract Bill of Quantities data", tier: "sponsor", feature: "bq_ocr", group: 3 },
  { id: "bq_export", icon: "📊", label: "BQ Export", shortLabel: "BQ Ex", description: "Review and export BQ data", tier: "sponsor", feature: "bq_export_page", group: 3 },
];

interface ActivityBarProps {
  activeModule: ModuleId;
  onModuleChange: (module: ModuleId) => void;
  userTier?: string;
  /** Resolved feature flags from the user's tier (from profile.tier_features). */
  userFeatures?: Record<string, boolean>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function ActivityBar({
  activeModule,
  onModuleChange,
  userTier = "basic",
  userFeatures,
  collapsed = false,
  onToggleCollapse,
}: ActivityBarProps) {
  // Check if user has access to a module
  const hasAccess = (module: ModuleConfig): boolean => {
    // BQ Export panel should always be reachable; the export permission is
    // enforced inside the panel itself (JSON‑only mode when denied).
    if (module.id === "bq_export") return true;

    // If the module has a feature key AND we have feature flags, use them
    if (module.feature && userFeatures) {
      return userFeatures[module.feature] === true;
    }
    // Fallback: use tier hierarchy
    if (!module.tier) return true;
    const tierOrder = ["basic", "sponsor", "premium", "admin"];
    const userIdx = tierOrder.indexOf(userTier);
    const reqIdx = tierOrder.indexOf(module.tier);
    return userIdx >= reqIdx;
  };

  // build elements with separators when group changes
  const rendered: React.ReactNode[] = [];
  let lastGroup: number | undefined;

  MODULES.forEach((mod) => {
    if (lastGroup !== undefined && mod.group !== lastGroup) {
      rendered.push(
        <div key={`sep-${mod.id}`} style={separator} />
      );
    }

    const isActive = activeModule === mod.id;
    const isLocked = !hasAccess(mod);

    rendered.push(
      <button
        key={mod.id}
        style={{
          ...moduleBtn,
          background: isActive ? "#ffffff" : "transparent",
          color: isActive ? "#1f2d3a" : isLocked ? "#b7c1ca" : "#607183",
          cursor: isLocked ? "not-allowed" : "pointer",
          borderLeft: isActive ? "3px solid #2e8ecb" : "3px solid transparent",
        }}
        onClick={() => !isLocked && onModuleChange(mod.id)}
        disabled={isLocked}
        title={isLocked ? `Requires ${mod.tier} tier` : mod.description}
      >
        <span style={{ fontSize: collapsed ? 18 : 16 }}>{mod.icon}</span>
        {!collapsed && (
          <span style={{ fontSize: 11, marginTop: 2 }}>{mod.shortLabel}</span>
        )}
        {isLocked && (
          <span style={lockIcon}>🔒</span>
        )}
      </button>
    );

    lastGroup = mod.group;
  });

  return (
    <div style={container}>
      {rendered}

      {/* Collapse toggle */}
      {onToggleCollapse && (
        <button
          style={{
            ...moduleBtn,
            marginTop: "auto",
            borderLeft: "3px solid transparent",
          }}
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span style={{ fontSize: 14 }}>{collapsed ? "▶" : "◀"}</span>
        </button>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  background: "linear-gradient(180deg, #f7fbff 0%, #f4f8f7 100%)",
  borderRight: "1px solid #d8e4ef",
  width: "fit-content",
  minWidth: 48,
  height: "100%",
};

const moduleBtn: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 8px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  transition: "all 0.15s ease",
  position: "relative",
  minHeight: 56,
  borderRadius: 8,
  margin: "2px 4px",
};

const lockIcon: React.CSSProperties = {
  position: "absolute",
  top: 4,
  right: 4,
  fontSize: 8,
};

const separator: React.CSSProperties = {
  height: 1,
  background: "#dce7f1",
  margin: "4px 0",
  width: "100%",
};
