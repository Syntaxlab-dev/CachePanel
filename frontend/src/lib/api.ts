export interface ServiceStat {
  service: string;
  hit_bytes: number;
  miss_bytes: number;
  total_bytes: number;
  hit_ratio: number;
  last_seen: string | null;
}

export interface ActivityBucket {
  service: string;
  bucket_start: string;
  hit_bytes: number;
  miss_bytes: number;
  requests: number;
}

export interface TimelinePoint {
  bucket_start: string;
  hit_bytes: number;
  miss_bytes: number;
  requests: number;
}

export interface ClientStat {
  client_ip: string;
  hit_bytes: number;
  miss_bytes: number;
  total_bytes: number;
  requests: number;
  last_seen: string | null;
}

export interface DashboardStats {
  overall: {
    total_requests: number;
    hit_requests: number;
    miss_requests: number;
    hit_ratio: number;
    hit_bytes: number;
    miss_bytes: number;
    bandwidth_saved_bytes: number;
  };
  services: ServiceStat[];
  recent_activity: ActivityBucket[];
  timeline: TimelinePoint[];
  top_clients: ClientStat[];
}

export interface SteamGame {
  app_id: number;
  name: string;
  playtime_minutes: number;
  last_played: number;
  icon_url: string | null;
  selected: boolean;
}

export interface BattleNetProductDto {
  code: string;
  name: string;
  publisher: string;
  selected: boolean;
}

export interface AppSettings {
  steam_api_key: string;
  steam_id64: string;
}

export interface SteamSizeStatus {
  apps: { name: string; size: string }[];
  total_size: string | null;
}

export interface HealthStatus {
  containers: { name: string; status: string; uptime_seconds: number | null }[];
}

export interface DiagnosticCheck {
  id: string;
  status: "ok" | "warn" | "fail" | "unknown";
  message: string;
}

export interface DiagnosticsResult {
  checks: DiagnosticCheck[];
}

export interface CacheScanResult {
  corrupt_file_count: number;
  sample_paths: string[];
  truncated: boolean;
}

export interface RunHistoryEntry {
  service: string;
  started_at: string;
  exit_code: number;
  duration_seconds: number;
}

export interface ExportBundle {
  schema_version: number;
  steam_app_ids: number[];
  battlenet_codes: string[];
  epic_app_ids: string[];
}

export interface AuthStatus {
  setup_required: boolean;
  authenticated: boolean;
}

export interface ServiceSchedule {
  enabled: boolean;
  hour: number;
  minute: number;
}

export interface ScheduleConfig {
  steam: ServiceSchedule;
  battlenet: ServiceSchedule;
  epic: ServiceSchedule;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    let detail: string | null = null;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.detail === "string") detail = parsed.detail;
    } catch {
      // not JSON -- fall through, detail stays null
    }
    throw new Error(detail ?? `${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  dashboardStats: () => request<DashboardStats>("/api/dashboard/stats"),

  steamLibrary: () => request<{ games: SteamGame[] }>("/api/steam/library"),
  saveSteamSelection: (appIds: number[]) =>
    request("/api/steam/selection", { method: "POST", body: JSON.stringify({ app_ids: appIds }) }),
  steamSizeStatus: () => request<SteamSizeStatus>("/api/steam/size-status"),

  battlenetCatalog: () => request<{ products: BattleNetProductDto[] }>("/api/battlenet/catalog"),
  saveBattlenetSelection: (codes: string[]) =>
    request("/api/battlenet/selection", { method: "POST", body: JSON.stringify({ codes }) }),

  epicSelection: () => request<{ app_ids: string[] }>("/api/epic/selection"),
  saveEpicSelection: (appIds: string[]) =>
    request("/api/epic/selection", { method: "POST", body: JSON.stringify({ app_ids: appIds }) }),

  runPrefill: (service: "steam" | "battlenet" | "epic") =>
    request<{ service: string; exit_code: number; output: string }>(`/api/prefill/${service}/run`, {
      method: "POST",
    }),

  getSettings: () => request<AppSettings>("/api/settings"),
  saveSettings: (partial: Partial<AppSettings>) =>
    request<AppSettings>("/api/settings", { method: "POST", body: JSON.stringify(partial) }),

  health: () => request<HealthStatus>("/api/health"),

  runHistory: () => request<{ runs: RunHistoryEntry[] }>("/api/prefill/history"),

  clearCache: () => request<{ message: string }>("/api/cache/clear", { method: "POST" }),

  diagnostics: () => request<DiagnosticsResult>("/api/health/diagnostics"),

  scanCache: () => request<CacheScanResult>("/api/cache/scan"),
  cleanCorrupted: () => request<{ message: string }>("/api/cache/clean-corrupted", { method: "POST" }),

  exportSelection: () => request<ExportBundle>("/api/export"),
  importSelection: (bundle: ExportBundle) =>
    request<ExportBundle>("/api/import", { method: "POST", body: JSON.stringify(bundle) }),

  authStatus: () => request<AuthStatus>("/api/auth/status"),
  authSetup: (username: string, password: string) =>
    request<{ ok: boolean }>("/api/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) }),
  authLogin: (username: string, password: string) =>
    request<{ ok: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  authLogout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  getSchedule: () => request<ScheduleConfig>("/api/schedule"),
  saveSchedule: (partial: Partial<ScheduleConfig>) =>
    request<ScheduleConfig>("/api/schedule", { method: "POST", body: JSON.stringify(partial) }),
};

export function prefillStreamUrl(service: "steam" | "battlenet" | "epic"): string {
  return `/api/prefill/${service}/stream`;
}
