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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
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
};
