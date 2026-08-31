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
  cover_url: string | null;
  selected: boolean;
}

export interface BattleNetProductDto {
  code: string;
  name: string;
  publisher: string;
  cover_url: string | null;
  selected: boolean;
}

export interface AppSettings {
  steam_api_key: string;
  steam_id64: string;
  steamgriddb_api_key: string;
  discord_webhook_url: string;
  discord_notify_success: boolean;
  discord_notify_failure: boolean;
  discord_notify_disk_warning: boolean;
  run_history_limit: number;
  report_enabled: boolean;
  report_weekday: number;
  report_hour: number;
  report_minute: number;
  public_display_enabled: boolean;
  heartbeat_url: string;
  ntfy_server_url: string;
  ntfy_topic: string;
  auto_backup_enabled: boolean;
  auto_backup_weekday: number;
  auto_backup_hour: number;
  auto_backup_minute: number;
  auto_backup_retention: number;
  auto_clean_corruption_enabled: boolean;
  traffic_alert_threshold_gb: number;
  display_party_name: string;
  ip_allowlist: string[];
  api_token_rate_limit_per_minute: number;
  quiet_hours_enabled: boolean;
  quiet_hours_start_hour: number;
  quiet_hours_start_minute: number;
  quiet_hours_end_hour: number;
  quiet_hours_end_minute: number;
  notification_templates: Record<string, string>;
  monthly_budget_gb: number;
  grafana_url: string;
  grafana_api_key: string;
  sftp_backup_enabled: boolean;
  sftp_host: string;
  sftp_port: number;
  sftp_username: string;
  sftp_password: string;
  sftp_private_key: string;
  sftp_remote_dir: string;
  sftp_retention: number;
}

export type NotificationTemplateEvent = "prefill_success" | "prefill_failure" | "disk_warning" | "traffic_alert" | "weekly_report";

export interface AuditLogEntry {
  timestamp: string;
  action: string;
  username: string;
  detail: string;
  client_ip: string;
}

// GET /api/settings only -- carries the caller's own current IP alongside
// the persisted AppSettings fields, so the ip_allowlist editor can warn
// before saving a list that would exclude the very browser editing it.
// Never part of the POST /api/settings response, which only ever returns
// what update_settings() persisted.
export interface AppSettingsResponse extends AppSettings {
  client_ip: string;
}

export interface WebauthnCredential {
  credential_id: string;
  label: string;
  rp_id: string;
  created_date: string;
}

export interface PanelSession {
  session_id: string;
  created_at: string;
  last_seen_at: string;
  client_ip: string;
  user_agent: string;
  is_current: boolean;
}

export interface ApiToken {
  id: number;
  label: string;
  created_date: string;
}

export interface InstanceToken {
  id: number;
  label: string;
  created_date: string;
}

export interface SlaveInstance {
  id: number;
  name: string;
  base_url: string;
  created_date: string;
}

export interface SlaveInstanceStatus {
  id: number;
  name: string;
  base_url: string;
  status: HaSensors | null;
  error: string | null;
}

export interface RemotePrefillResult {
  service: string;
  exit_code: number;
  output: string;
}

export interface LiveTickerEntry {
  timestamp: string;
  service: string;
  client_ip: string;
  bytes: number;
  cache_status: string;
}

export interface DailyStat {
  date: string;
  hit_bytes: number;
  miss_bytes: number;
  total_requests: number;
}

export interface UpcomingRelease {
  app_id: number;
  name: string;
  release_date: string;
  header_image: string;
  store_url: string;
}

export interface HaSensors {
  hit_ratio_percent: number;
  bandwidth_saved_gb: number;
  total_requests: number;
  disk_percent_used: number | null;
  forecast_available: boolean;
  hours_until_full: number | null;
}

export interface CacheForecast {
  available: boolean;
  reason: "not_enough_data" | "not_growing" | "disk_usage_unavailable" | null;
  total_bytes: number | null;
  used_bytes: number | null;
  percent_used: number | null;
  growth_bytes_per_day: number | null;
  hours_until_full: number | null;
}

export type TrafficWindow = "24h" | "7d" | "30d";

// Shape of GET /display-data (public, unauthenticated LAN-party screen --
// see backend/app/routers/public_display.py for exactly which fields this
// is allowed to contain; deliberately narrower than DashboardStats, e.g.
// no top_clients).
export interface PublicDisplayData {
  party_name: string;
  overall: {
    total_requests: number;
    hit_ratio: number;
    bandwidth_saved_bytes: number;
    hit_bytes: number;
    miss_bytes: number;
  };
  services: { service: string; hit_bytes: number; miss_bytes: number }[];
  timeline: TimelinePoint[];
  percent_used: number | null;
  forecast: {
    available: boolean;
    reason: "not_enough_data" | "not_growing" | "disk_usage_unavailable" | null;
    hours_until_full: number | null;
    growth_bytes_per_day: number | null;
  };
  ready_counts: { steam: number; battlenet: number; epic: number };
  records: {
    most_bandwidth_saved_bytes: number;
    most_bandwidth_saved_date: string | null;
    highest_hit_ratio: number;
    highest_hit_ratio_date: string | null;
    most_requests_in_day: number;
    most_requests_in_day_date: string | null;
    best_week_avg_bandwidth_bytes: number;
    best_week_avg_start_date: string | null;
    best_week_avg_end_date: string | null;
    current_hit_ratio_streak_days: number;
  };
}

export interface VersionInfo {
  git_sha: string;
  git_sha_short: string;
  repo_url: string;
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

export type PanelRole = "admin" | "viewer";

export interface PanelUser {
  username: string;
  role: PanelRole;
}

export interface BackupBundle {
  schema_version: number;
  // Base64-encoded, still Fernet-encrypted on the backend -- the frontend
  // never sees plaintext secrets here, just passes this through as an
  // opaque blob on download/upload. Only decrypts successfully if restored
  // on the same host it was backed up from.
  settings_encrypted: string;
  schedule: ScheduleConfigLike;
  run_history: RunHistoryEntry[];
  // Every panel account's {username, password_hash, role, totp_secret,
  // totp_enabled} since the 3rd feature round added roles/2FA -- accepts
  // an older single-object (pre-Welle-4) or role/2FA-less (pre-3rd-round)
  // backup on restore too, the backend normalizes both shapes.
  auth: Record<string, unknown>[] | Record<string, unknown> | null;
}

// ScheduleConfig itself is defined further down, after this type is used --
// a small structural duplicate here avoids reordering the whole file.
type ScheduleConfigLike = Record<string, { enabled: boolean; windows: ScheduleWindow[] }>;

export interface GrafanaDatasourceCandidate {
  uid: string;
  name: string;
}

export type GrafanaImportResult =
  | { ok: true; ambiguous: false }
  | { ok: false; ambiguous: true; candidates: GrafanaDatasourceCandidate[] };

export interface UpdateCheckResult {
  checked: boolean;
  update_available: boolean;
  latest_sha: string | null;
}

export interface AuthStatus {
  setup_required: boolean;
  authenticated: boolean;
  role: PanelRole | null;
  totp_enabled: boolean;
}

export interface OidcStatus {
  enabled: boolean;
  provider_name: string;
}

export interface LoginResult {
  ok: boolean;
  totp_required: boolean;
}

export interface TotpSetupResult {
  secret: string;
  uri: string;
}

export interface ScheduleWindow {
  id: number;
  hour: number;
  minute: number;
  // 0=Monday..6=Sunday. Empty means every day (same default the backend
  // applies when this is omitted/empty on save).
  days: number[];
}

export interface ServiceSchedule {
  enabled: boolean;
  windows: ScheduleWindow[];
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
  dashboardStats: (window: TrafficWindow = "24h") =>
    request<DashboardStats>(`/api/dashboard/stats?window=${window}`),

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

  getSettings: () => request<AppSettingsResponse>("/api/settings"),
  saveSettings: (partial: Partial<AppSettings>) =>
    request<AppSettings>("/api/settings", { method: "POST", body: JSON.stringify(partial) }),
  testDiscordWebhook: (webhookUrl: string) =>
    request<{ message: string }>("/api/settings/notifications/test", {
      method: "POST",
      body: JSON.stringify({ webhook_url: webhookUrl }),
    }),
  testNtfy: (serverUrl: string, topic: string) =>
    request<{ message: string }>("/api/settings/notifications/test-ntfy", {
      method: "POST",
      body: JSON.stringify({ server_url: serverUrl, topic }),
    }),
  sendCacheReport: (webhookUrl: string) =>
    request<{ message: string }>("/api/settings/notifications/test-report", {
      method: "POST",
      body: JSON.stringify({ webhook_url: webhookUrl }),
    }),
  getVersion: () => request<VersionInfo>("/api/settings/version"),
  checkForUpdate: () => request<UpdateCheckResult>("/api/settings/update-check"),
  // Dedicated fetch (not the generic request<T>() helper above) because a
  // 409 here carries a structured `{message, candidates}` body -- see
  // routers/settings.py's own docstring -- that the picker UI needs to
  // read, not just a plain string `detail` the generic helper extracts.
  importGrafanaDashboard: async (datasourceUid?: string): Promise<GrafanaImportResult> => {
    const res = await fetch("/api/settings/grafana/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasource_uid: datasourceUid ?? null }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body?.detail?.candidates) {
      return { ok: false, ambiguous: true, candidates: body.detail.candidates as GrafanaDatasourceCandidate[] };
    }
    if (!res.ok) {
      const message = typeof body?.detail === "string" ? body.detail : `${res.status} ${res.statusText}`;
      throw new Error(message);
    }
    return { ok: true, ambiguous: false };
  },
  testSftp: (params: {
    host: string;
    port: number;
    username: string;
    password: string;
    private_key: string;
    remote_dir: string;
  }) => request<{ message: string }>("/api/settings/sftp/test", { method: "POST", body: JSON.stringify(params) }),
  previewNotificationTemplate: (eventKey: NotificationTemplateEvent, template: string) =>
    request<{ preview: string }>("/api/settings/notification-templates/preview", {
      method: "POST",
      body: JSON.stringify({ event_key: eventKey, template }),
    }),

  auditLog: (params: { action?: string; username?: string; q?: string; since?: string; until?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params.action) query.set("action", params.action);
    if (params.username) query.set("username", params.username);
    if (params.q) query.set("q", params.q);
    if (params.since) query.set("since", params.since);
    if (params.until) query.set("until", params.until);
    if (params.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return request<{ entries: AuditLogEntry[] }>(`/api/audit-log${qs ? `?${qs}` : ""}`);
  },
  auditLogActions: () => request<{ actions: string[] }>("/api/audit-log/actions"),

  getBackup: () => request<BackupBundle>("/api/backup"),
  restoreBackup: (bundle: BackupBundle) =>
    request<{ ok: boolean }>("/api/backup/restore", { method: "POST", body: JSON.stringify(bundle) }),

  health: () => request<HealthStatus>("/api/health"),

  runHistory: () => request<{ runs: RunHistoryEntry[] }>("/api/prefill/history"),

  clearCache: () => request<{ message: string }>("/api/cache/clear", { method: "POST" }),

  diagnostics: () => request<DiagnosticsResult>("/api/health/diagnostics"),
  cacheForecast: () => request<CacheForecast>("/api/health/forecast"),

  scanCache: () => request<CacheScanResult>("/api/cache/scan"),
  cleanCorrupted: () => request<{ message: string }>("/api/cache/clean-corrupted", { method: "POST" }),

  exportSelection: () => request<ExportBundle>("/api/export"),
  importSelection: (bundle: ExportBundle) =>
    request<ExportBundle>("/api/import", { method: "POST", body: JSON.stringify(bundle) }),

  authStatus: () => request<AuthStatus>("/api/auth/status"),
  authSetup: (username: string, password: string) =>
    request<{ ok: boolean }>("/api/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) }),
  authLogin: (username: string, password: string) =>
    request<LoginResult>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  authLoginTotp: (code: string) =>
    request<{ ok: boolean }>("/api/auth/login/totp", { method: "POST", body: JSON.stringify({ code }) }),
  authLogout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  oidcStatus: () => request<OidcStatus>("/api/auth/oidc/status"),

  totpSetup: () => request<TotpSetupResult>("/api/auth/totp/setup", { method: "POST" }),
  totpConfirm: (code: string) =>
    request<{ ok: boolean }>("/api/auth/totp/confirm", { method: "POST", body: JSON.stringify({ code }) }),
  totpDisable: (password: string) =>
    request<{ ok: boolean }>("/api/auth/totp/disable", { method: "POST", body: JSON.stringify({ password }) }),

  listSessions: () => request<{ sessions: PanelSession[] }>("/api/auth/sessions"),
  revokeSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),

  webauthnRegisterBegin: () =>
    request<Record<string, unknown>>("/api/auth/webauthn/register/begin", { method: "POST" }),
  webauthnRegisterComplete: (credential: Record<string, unknown>, label: string) =>
    request<{ ok: boolean }>("/api/auth/webauthn/register/complete", {
      method: "POST",
      body: JSON.stringify({ credential, label }),
    }),
  webauthnListCredentials: () => request<{ credentials: WebauthnCredential[] }>("/api/auth/webauthn/credentials"),
  webauthnDeleteCredential: (credentialId: string) =>
    request<{ ok: boolean }>(`/api/auth/webauthn/credentials/${encodeURIComponent(credentialId)}`, {
      method: "DELETE",
    }),
  webauthnLoginBegin: () =>
    request<Record<string, unknown>>("/api/auth/webauthn/login/begin", { method: "POST" }),
  webauthnLoginComplete: (credential: Record<string, unknown>) =>
    request<{ ok: boolean }>("/api/auth/webauthn/login/complete", {
      method: "POST",
      body: JSON.stringify({ credential }),
    }),

  listUsers: () => request<{ users: PanelUser[] }>("/api/users"),
  addUser: (username: string, password: string, role: PanelRole) =>
    request<{ ok: boolean }>("/api/users", { method: "POST", body: JSON.stringify({ username, password, role }) }),
  removeUser: (username: string) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(username)}`, { method: "DELETE" }),

  getSchedule: () => request<ScheduleConfig>("/api/schedule"),
  saveSchedule: (partial: Partial<ScheduleConfig>) =>
    request<ScheduleConfig>("/api/schedule", { method: "POST", body: JSON.stringify(partial) }),

  listTokens: () => request<{ tokens: ApiToken[] }>("/api/tokens"),
  createToken: (label: string) =>
    request<{ token: string }>("/api/tokens", { method: "POST", body: JSON.stringify({ label }) }),
  deleteToken: (id: number) => request<{ ok: boolean }>(`/api/tokens/${id}`, { method: "DELETE" }),

  liveTicker: () => request<{ entries: LiveTickerEntry[] }>("/api/dashboard/live-ticker"),
  trends: (days: number = 30) => request<{ days: DailyStat[] }>(`/api/dashboard/trends?days=${days}`),

  upcomingReleases: () =>
    request<{ releases: UpcomingRelease[] }>("/api/dashboard/upcoming-releases"),
  haSensors: () => request<HaSensors>("/api/ha/sensors"),

  webpushVapidPublicKey: () => request<{ public_key: string }>("/api/webpush/vapid-public-key"),
  webpushSubscribe: (subscription: unknown) =>
    request<{ ok: boolean }>("/api/webpush/subscribe", { method: "POST", body: JSON.stringify({ subscription }) }),
  webpushUnsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>("/api/webpush/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
  webpushTest: () =>
    request<{ message: string; subscriber_count: number }>("/api/webpush/test", { method: "POST" }),

  clientLabels: () => request<{ labels: Record<string, string> }>("/api/client-labels"),
  setClientLabel: (ip: string, label: string) =>
    request<{ labels: Record<string, string> }>("/api/client-labels", {
      method: "POST",
      body: JSON.stringify({ ip, label }),
    }),
  deleteClientLabel: (ip: string) =>
    request<{ labels: Record<string, string> }>(`/api/client-labels/${encodeURIComponent(ip)}`, {
      method: "DELETE",
    }),

  listInstanceTokens: () => request<{ tokens: InstanceToken[] }>("/api/instance-tokens"),
  createInstanceToken: (label: string) =>
    request<{ token: string }>("/api/instance-tokens", { method: "POST", body: JSON.stringify({ label }) }),
  deleteInstanceToken: (id: number) => request<{ ok: boolean }>(`/api/instance-tokens/${id}`, { method: "DELETE" }),

  listInstances: () => request<{ instances: SlaveInstance[] }>("/api/instances"),
  addInstance: (name: string, base_url: string, token: string) =>
    request<{ id: number }>("/api/instances", { method: "POST", body: JSON.stringify({ name, base_url, token }) }),
  removeInstance: (id: number) => request<{ ok: boolean }>(`/api/instances/${id}`, { method: "DELETE" }),
  instancesSummary: () => request<{ instances: SlaveInstanceStatus[] }>("/api/instances/summary"),
  triggerRemotePrefill: (id: number, service: "steam" | "battlenet" | "epic") =>
    request<RemotePrefillResult>(`/api/instances/${id}/prefill/${service}`, { method: "POST" }),
};

export function prefillStreamUrl(service: "steam" | "battlenet" | "epic"): string {
  return `/api/prefill/${service}/stream`;
}

// Deliberately its own unauthenticated fetch, not routed through `api.*` /
// request() -- this hits /display-data (no /api/ prefix, no session
// cookie sent or needed, see public_display.py) and a 404 there just means
// "the LAN-party display isn't enabled", which the caller treats as a
// normal falsy result rather than an error to surface.
export async function fetchPublicDisplayData(): Promise<PublicDisplayData | null> {
  const res = await fetch("/display-data");
  if (!res.ok) return null;
  return (await res.json()) as PublicDisplayData;
}
