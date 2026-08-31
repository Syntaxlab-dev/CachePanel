// Per-viewer dashboard customization (widget order + which widgets are
// hidden) -- localStorage only, same "client-side UI preference, no
// server round-trip" contract as theme.ts's dark mode / accent color.

export type WidgetId =
  | "setupChecklist"
  | "systemStatus"
  | "diagnostics"
  | "cacheIntegrity"
  | "cacheForecast"
  | "runHistory"
  | "trafficTimeline"
  | "trafficPerService"
  | "topClients"
  | "recentActivity"
  | "liveTicker"
  | "trends"
  | "upcomingReleases";

// Single source of truth for both the default layout and for sanitizing
// whatever's in localStorage -- if a future wave adds or removes a widget,
// a returning user's stored layout must neither crash nor silently drop
// the new widget forever.
export const DEFAULT_WIDGET_ORDER: WidgetId[] = [
  "setupChecklist",
  "systemStatus",
  "diagnostics",
  "cacheIntegrity",
  "cacheForecast",
  "liveTicker",
  "runHistory",
  "trafficTimeline",
  "trends",
  "trafficPerService",
  "topClients",
  "recentActivity",
  "upcomingReleases",
];

const STORAGE_KEY = "cachepanel-dashboard-layout";

export interface DashboardLayout {
  order: WidgetId[];
  hidden: WidgetId[];
}

function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && (DEFAULT_WIDGET_ORDER as string[]).includes(value);
}

// Drops unknown IDs (widget removed since this was saved), appends any
// known IDs missing from the stored order (widget added since this was
// saved) at the end, dedupes. Never trusts stored JSON shape blindly.
function sanitize(order: unknown, hidden: unknown): DashboardLayout {
  const known = (Array.isArray(order) ? order : []).filter(isWidgetId);
  const deduped = Array.from(new Set(known));
  const missing = DEFAULT_WIDGET_ORDER.filter((id) => !deduped.includes(id));
  const safeHidden = Array.from(new Set((Array.isArray(hidden) ? hidden : []).filter(isWidgetId)));
  return { order: [...deduped, ...missing], hidden: safeHidden };
}

function defaultLayout(): DashboardLayout {
  return { order: [...DEFAULT_WIDGET_ORDER], hidden: [] };
}

export function getStoredLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw);
    return sanitize(parsed?.order, parsed?.hidden);
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout: DashboardLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // localStorage unavailable (private browsing quirks, etc.) -- the
    // layout just won't persist across reloads, not worth surfacing.
  }
}

export function resetLayout(): DashboardLayout {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // see saveLayout
  }
  return defaultLayout();
}
