import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowDownCircle,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Circle,
  Download,
  Eye,
  EyeOff,
  Gauge,
  HardDrive,
  HelpCircle,
  History,
  Image as ImageIcon,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Radio,
  ScanSearch,
  Search,
  Server,
  Settings2,
  Trash2,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrafficChart } from "@/components/TrafficChart";
import { TrendsChart } from "@/components/TrendsChart";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { InfoTooltip } from "@/components/InfoTooltip";
import {
  api,
  type AppSettings,
  type CacheForecast,
  type CacheScanResult,
  type DailyStat,
  type DashboardStats,
  type DiagnosticCheck,
  type HealthStatus,
  type LiveTickerEntry,
  type RunHistoryEntry,
  type ScheduleConfig,
  type TrafficWindow,
  type UpcomingRelease,
} from "@/lib/api";
import { formatBytes, formatDaysApprox, formatPercent, formatUptime, cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { getStoredLayout, saveLayout, resetLayout, type DashboardLayout, type WidgetId } from "@/lib/dashboardLayout";
import { setDiagnosticsBadge, clearDiagnosticsBadge } from "@/lib/diagnosticsBadge";

const AUTO_REFRESH_KEY = "cachepanel-dashboard-autorefresh";
const AUTO_REFRESH_INTERVAL_MS = 30_000;
const TRAFFIC_WINDOWS: TrafficWindow[] = ["24h", "7d", "30d"];
const TRENDS_RANGES = [30, 90, 365] as const;
type TrendsRange = (typeof TRENDS_RANGES)[number];

function getStoredAutoRefresh(): boolean {
  try {
    return localStorage.getItem(AUTO_REFRESH_KEY) === "1";
  } catch {
    return false;
  }
}

const SERVICE_LABEL: Record<string, string> = {
  steam: "Steam",
  battlenet: "Battle.net",
  epic: "Epic Games",
};

export function Dashboard() {
  const { t, lang } = useI18n();
  const { role, totpEnabled } = useAuth();
  const isViewer = role === "viewer";
  const locale = lang === "de" ? "de-DE" : "en-US";
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [history, setHistory] = useState<RunHistoryEntry[] | null>(null);
  const [clearing, setClearing] = useState(false);
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [scan, setScan] = useState<CacheScanResult | null>(null);
  const [forecast, setForecast] = useState<CacheForecast | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [layout, setLayout] = useState<DashboardLayout>(() => getStoredLayout());
  const [customizing, setCustomizing] = useState(false);
  const [trafficWindow, setTrafficWindow] = useState<TrafficWindow>("24h");
  const [autoRefresh, setAutoRefresh] = useState(() => getStoredAutoRefresh());
  const [historySearch, setHistorySearch] = useState("");
  const [liveTicker, setLiveTicker] = useState<LiveTickerEntry[] | null>(null);
  const [trends, setTrends] = useState<DailyStat[] | null>(null);
  const [trendsRange, setTrendsRange] = useState<TrendsRange>(30);
  const [clientLabels, setClientLabels] = useState<Record<string, string>>({});
  const [editingClientIp, setEditingClientIp] = useState<string | null>(null);
  const [clientLabelDraft, setClientLabelDraft] = useState("");
  const [savingClientLabel, setSavingClientLabel] = useState(false);
  const [checklistSettings, setChecklistSettings] = useState<AppSettings | null>(null);
  const [checklistSchedule, setChecklistSchedule] = useState<ScheduleConfig | null>(null);
  const [checklistWebpush, setChecklistWebpush] = useState(false);
  const [upcomingReleases, setUpcomingReleases] = useState<UpcomingRelease[] | null>(null);

  const loadAll = useCallback(
    (window: TrafficWindow) => {
      api
        .dashboardStats(window)
        .then(setStats)
        .catch((err) => setError(err instanceof Error ? err.message : t("common.unknownError")));
      api.health().then(setHealth).catch(() => setHealth(null));
      api
        .runHistory()
        .then((data) => setHistory(data.runs))
        .catch(() => setHistory(null));
      api
        .diagnostics()
        .then((data) => setChecks(data.checks))
        .catch(() => setChecks(null));
      api.cacheForecast().then(setForecast).catch(() => setForecast(null));
    },
    [t],
  );

  useEffect(() => {
    loadAll(trafficWindow);
  }, [trafficWindow, loadAll]);

  useEffect(() => {
    api
      .clientLabels()
      .then((data) => setClientLabels(data.labels))
      .catch(() => setClientLabels({}));
  }, []);

  // Feeds the "setup checklist" widget below -- pure client-side
  // evaluation of settings/schedule the app already has endpoints for, no
  // new backend endpoint needed for this. Web push is the one item that
  // can't be read from AppSettings (it's a per-browser Push API
  // subscription, not a server-side setting -- see Settings.tsx's
  // identical check), so it gets its own small navigator call here too.
  useEffect(() => {
    api.getSettings().then(setChecklistSettings).catch(() => setChecklistSettings(null));
    api.getSchedule().then(setChecklistSchedule).catch(() => setChecklistSchedule(null));
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then((sub) => setChecklistWebpush(!!sub))
        .catch(() => setChecklistWebpush(false));
    }
  }, []);

  // Own, faster poll cadence than the main dashboard refresh (which the
  // user can even leave paused) -- the live ticker is only useful if it
  // actually stays current. Independent of `customizing`/`autoRefresh`
  // since a lightweight ~5000-line tail read (see routers/dashboard.py's
  // live-ticker endpoint) is cheap enough to just always run while this
  // page is mounted.
  useEffect(() => {
    function loadTicker() {
      api
        .liveTicker()
        .then((data) => setLiveTicker(data.entries))
        .catch(() => setLiveTicker(null));
    }
    loadTicker();
    const id = setInterval(loadTicker, 10_000);
    return () => clearInterval(id);
  }, []);

  // Independent of the main dashboard refresh -- daily totals only ever
  // change once a day (see scheduler_service.py's 23:55 snapshot job), so
  // this just needs to reload when the user picks a different range, not
  // on any polling cadence.
  useEffect(() => {
    api
      .trends(trendsRange)
      .then((data) => setTrends(data.days))
      .catch(() => setTrends(null));
  }, [trendsRange]);

  // Server-cached for hours (see services/upcoming_releases.py) -- fetched
  // once on mount, not tied to any refresh cadence, same reasoning as trends.
  useEffect(() => {
    api
      .upcomingReleases()
      .then((data) => setUpcomingReleases(data.releases))
      .catch(() => setUpcomingReleases(null));
  }, []);

  // Auto-refresh: paused while the user is actively rearranging tiles in
  // "Anpassen" mode (a refresh mid-drag wouldn't lose the layout itself --
  // that's saved to localStorage on every move -- but it would replace
  // whatever the user is looking at right as they're comparing tiles,
  // which is a worse experience than just holding off for a few seconds).
  useEffect(() => {
    if (!autoRefresh || customizing) return;
    const id = setInterval(() => loadAll(trafficWindow), AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, customizing, trafficWindow, loadAll]);

  // Tab title + favicon dot reflect diagnostics status while this page is
  // mounted -- cleared on unmount so navigating away doesn't leave a stale
  // warning badge showing if the underlying problem gets fixed later.
  useEffect(() => {
    const hasProblem = !!checks?.some((c) => c.status === "fail" || c.status === "warn");
    if (hasProblem) {
      setDiagnosticsBadge();
    } else {
      clearDiagnosticsBadge();
    }
    return () => clearDiagnosticsBadge();
  }, [checks]);

  function toggleAutoRefresh() {
    setAutoRefresh((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_REFRESH_KEY, next ? "1" : "0");
      } catch {
        // localStorage unavailable -- the toggle just won't persist across reloads
      }
      return next;
    });
  }

  async function handleScanCache() {
    setScanning(true);
    try {
      setScan(await api.scanCache());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("dashboard.scanFailed"));
    } finally {
      setScanning(false);
    }
  }

  async function handleCleanCorrupted() {
    if (!window.confirm(t("dashboard.cacheIntegrity.cleanConfirm"))) return;
    setCleaning(true);
    try {
      const result = await api.cleanCorrupted();
      toast.success(result.message);
      setScan(await api.scanCache());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("dashboard.cleanFailed"));
    } finally {
      setCleaning(false);
    }
  }

  async function handleClearCache() {
    const confirmed = window.confirm(t("dashboard.clearCacheConfirm"));
    if (!confirmed) return;

    setClearing(true);
    try {
      const result = await api.clearCache();
      toast.success(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("dashboard.clearCacheFailed"));
    } finally {
      setClearing(false);
    }
  }

  function moveWidget(id: WidgetId, direction: -1 | 1) {
    setLayout((prev) => {
      const index = prev.order.indexOf(id);
      const swapWith = index + direction;
      // Swaps within the full known-widget order, not just the currently
      // visible/available ones -- simpler and robust, at the cost of an
      // occasional no-visible-effect click if the neighbor in that
      // direction happens to be a widget with no data yet (e.g. diagnostics
      // before the API call resolves). Acceptable trade-off for a small
      // panel; a "visible order only" version would need to reconcile two
      // different orderings on every render for a rare edge case.
      if (index === -1 || swapWith < 0 || swapWith >= prev.order.length) return prev;
      const next = [...prev.order];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      const updated = { ...prev, order: next };
      saveLayout(updated);
      return updated;
    });
  }

  function toggleWidgetHidden(id: WidgetId) {
    setLayout((prev) => {
      const hidden = prev.hidden.includes(id) ? prev.hidden.filter((h) => h !== id) : [...prev.hidden, id];
      const updated = { ...prev, hidden };
      saveLayout(updated);
      return updated;
    });
  }

  function handleResetLayout() {
    setLayout(resetLayout());
  }

  function startEditingClientLabel(ip: string) {
    setEditingClientIp(ip);
    setClientLabelDraft(clientLabels[ip] ?? "");
  }

  async function handleSaveClientLabel(ip: string) {
    const label = clientLabelDraft.trim();
    setSavingClientLabel(true);
    try {
      if (label) {
        const result = await api.setClientLabel(ip, label);
        setClientLabels(result.labels);
      } else {
        // Empty input clears an existing label instead of saving a blank one.
        const result = await api.deleteClientLabel(ip);
        setClientLabels(result.labels);
      }
      setEditingClientIp(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("dashboard.clientLabelSaveFailed"));
    } finally {
      setSavingClientLabel(false);
    }
  }

  function handleExportCsv() {
    if (!stats) return;
    const rows: (string | number)[][] = [
      ["metric", "value"],
      ["hit_ratio", stats.overall.hit_ratio],
      ["hit_bytes", stats.overall.hit_bytes],
      ["miss_bytes", stats.overall.miss_bytes],
      ["bandwidth_saved_bytes", stats.overall.bandwidth_saved_bytes],
      ["total_requests", stats.overall.total_requests],
      ["hit_requests", stats.overall.hit_requests],
      ["miss_requests", stats.overall.miss_requests],
      [],
      ["service", "hit_bytes", "miss_bytes", "total_bytes", "hit_ratio", "last_seen"],
      ...stats.services.map((s) => [s.service, s.hit_bytes, s.miss_bytes, s.total_bytes, s.hit_ratio, s.last_seen ?? ""]),
    ];
    downloadCsv(`cachepanel-stats-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  // Draws a small shareable snapshot card straight onto a <canvas> (title,
  // the 3 headline numbers, a timestamp) and offers it as a PNG download --
  // deliberately no html2canvas/similar dependency for this, drawing a
  // handful of text/rect primitives ourselves is simple enough that adding
  // a library just to rasterize a fixed, known layout would be the wrong
  // trade (same reasoning CommandPalette.tsx's plain substring filter --
  // instead of a fuzzy-match library -- already applies in this project).
  // Fixed dark colors rather than the viewer's current CSS theme vars, so
  // an exported/shared image looks the same regardless of who generated it
  // -- same idea as PublicDisplay.tsx's own fixed palette.
  function handleExportImage() {
    if (!stats) return;
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 450;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0a0d13";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#f1f5f9";
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.fillText("CachePanel", 40, 60);

    const statBoxes: { label: string; value: string }[] = [
      { label: t("dashboard.stat.hitRatio"), value: formatPercent(stats.overall.hit_ratio) },
      { label: t("dashboard.stat.fromCache"), value: formatBytes(stats.overall.hit_bytes) },
      { label: t("dashboard.stat.totalRequests"), value: stats.overall.total_requests.toLocaleString(locale) },
    ];
    const boxWidth = (canvas.width - 40 * 2 - 24 * 2) / 3;
    statBoxes.forEach((box, i) => {
      const x = 40 + i * (boxWidth + 24);
      const y = 110;
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, boxWidth, 140);
      ctx.fillStyle = "#7dd3fc";
      ctx.font = "600 32px system-ui, sans-serif";
      ctx.fillText(box.value, x + 20, y + 70);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(box.label.toUpperCase(), x + 20, y + 100);
    });

    ctx.fillStyle = "#64748b";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(new Date().toLocaleString(locale), 40, canvas.height - 30);
    ctx.fillText("github.com/Syntaxlab-dev/CachePanel", 40, canvas.height - 12);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cachepanel-snapshot-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  // Search matches the service's display label (e.g. "Battle.net") or its
  // status text (localized "erfolgreich" / "Exit-Code 1") -- covers the two
  // things a search over a short run-history list is actually useful for,
  // same scope as Steam.tsx's name-only search since there's no other
  // meaningfully searchable field on a run-history entry.
  const filteredHistory = useMemo(() => {
    if (!history) return [];
    const q = historySearch.trim().toLowerCase();
    if (!q) return history;
    return history.filter((run) => {
      const label = (SERVICE_LABEL[run.service] ?? run.service).toLowerCase();
      const status =
        run.exit_code === 0 ? t("dashboard.runSuccessful").toLowerCase() : `exit-code ${run.exit_code}`;
      return label.includes(q) || status.includes(q) || run.service.toLowerCase().includes(q);
    });
  }, [history, historySearch, t]);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
        <AlertCircle className="h-4 w-4" /> {t("dashboard.statsError")} {error}
      </div>
    );
  }

  if (!stats) {
    return <div className="text-sm text-[var(--muted)]">{t("dashboard.loading")}</div>;
  }

  const { overall, services, recent_activity, timeline, top_clients } = stats;

  // Only the widgets that currently have something to show get an entry
  // here -- same conditions the old inline `{health && (...)}` etc. guards
  // used, just centralized so the render loop below can treat every
  // widget uniformly (present in layout.order + widgetDefs = renderable).
  const widgetDefs: Partial<Record<WidgetId, { title: string; node: ReactNode }>> = {};

  // Only rendered once both fetches (see the effect above) have actually
  // resolved -- showing every item as "not done" for a moment while still
  // loading would be a false, mildly alarming flash, not just a cosmetic
  // nit.
  if (checklistSettings && checklistSchedule) {
    const checklistItems: { done: boolean; label: string; to: string }[] = [
      {
        done: Boolean(checklistSettings.steam_api_key && checklistSettings.steam_id64),
        label: t("dashboard.checklist.steam"),
        to: "/settings#section-users",
      },
      {
        done:
          checklistSchedule.steam.enabled || checklistSchedule.battlenet.enabled || checklistSchedule.epic.enabled,
        label: t("dashboard.checklist.schedule"),
        to: "/settings#section-users",
      },
      {
        done: checklistSettings.auto_backup_enabled,
        label: t("dashboard.checklist.backup"),
        to: "/settings#section-autobackup",
      },
      {
        done: Boolean(checklistSettings.discord_webhook_url || checklistSettings.ntfy_topic || checklistWebpush),
        label: t("dashboard.checklist.notifications"),
        to: "/settings#section-notifications",
      },
      {
        done: totpEnabled,
        label: t("dashboard.checklist.twoFactor"),
        to: "/settings#section-2fa",
      },
    ];
    const doneCount = checklistItems.filter((i) => i.done).length;

    widgetDefs.setupChecklist = {
      title: t("dashboard.checklist"),
      node: (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-4 w-4" /> {t("dashboard.checklist")}
            </CardTitle>
            <span className="text-xs text-[var(--muted)]">
              {doneCount} {t("dashboard.checklist.of")} {checklistItems.length}
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {checklistItems.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"
              >
                {item.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--ok)]" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                )}
                <span className={item.done ? "text-[var(--muted)] line-through" : "text-[var(--ink)]"}>
                  {item.label}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ),
    };
  }

  if (health) {
    widgetDefs.systemStatus = {
      title: t("dashboard.systemStatus"),
      node: (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4" /> {t("dashboard.systemStatus")}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={handleClearCache} disabled={clearing}>
              <Trash2 className="h-3.5 w-3.5" /> {clearing ? t("dashboard.clearingCache") : t("dashboard.clearCache")}
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {health.containers.map((c) => {
              const running = c.status === "running";
              return (
                <div key={c.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {running ? (
                      <CheckCircle2 className="h-4 w-4 text-[var(--ok)]" />
                    ) : (
                      <XCircle className="h-4 w-4 text-[var(--danger)]" />
                    )}
                    <span className="font-medium">{c.name}</span>
                  </div>
                  <span className="text-[var(--muted)]">
                    {running
                      ? t("dashboard.containerRunning")
                      : c.status === "not_found"
                        ? t("dashboard.containerNotFound")
                        : c.status}
                    {running && c.uptime_seconds != null && ` · seit ${formatUptime(c.uptime_seconds)}`}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ),
    };
  }

  if (checks && checks.length > 0) {
    widgetDefs.diagnostics = {
      title: t("dashboard.diagnostics"),
      node: (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanSearch className="h-4 w-4" /> {t("dashboard.diagnostics")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {checks.map((c) => (
              <div key={c.id} className="flex items-start gap-2 text-sm">
                <DiagnosticIcon status={c.status} />
                <span className="text-[var(--muted)]">{c.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ),
    };
  }

  widgetDefs.cacheIntegrity = {
    title: t("dashboard.cacheIntegrity"),
    node: (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {t("dashboard.cacheIntegrity")}
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleScanCache} disabled={scanning}>
              {scanning ? t("dashboard.cacheIntegrity.scanning") : t("dashboard.cacheIntegrity.scan")}
            </Button>
            {scan && scan.corrupt_file_count > 0 && (
              <Button variant="outline" size="sm" onClick={handleCleanCorrupted} disabled={cleaning}>
                <Trash2 className="h-3.5 w-3.5" />{" "}
                {cleaning ? t("dashboard.cacheIntegrity.cleaning") : t("dashboard.cacheIntegrity.clean")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!scan ? (
            <p className="text-sm text-[var(--muted)]">{t("dashboard.cacheIntegrity.notScanned")}</p>
          ) : scan.corrupt_file_count === 0 ? (
            <p className="flex items-center gap-2 text-sm text-[var(--ok)]">
              <CheckCircle2 className="h-4 w-4" /> {t("dashboard.cacheIntegrity.ok")}
            </p>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <p className="flex items-center gap-2 text-[var(--warn)]">
                <AlertTriangle className="h-4 w-4" /> {scan.corrupt_file_count}{" "}
                {t("dashboard.cacheIntegrity.found")}
              </p>
              {scan.sample_paths.length > 0 && (
                <ul className="ml-6 list-disc text-xs text-[var(--muted)]">
                  {scan.sample_paths.map((p) => (
                    <li key={p} className="truncate">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    ),
  };

  if (forecast) {
    const approx =
      forecast.available && forecast.hours_until_full != null
        ? formatDaysApprox(forecast.hours_until_full)
        : null;
    widgetDefs.cacheForecast = {
      title: t("dashboard.cacheForecast"),
      node: (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" /> {t("dashboard.cacheForecast")}
              <InfoTooltip text={t("dashboard.cacheForecastTooltip")} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!approx ? (
              <p className="text-sm text-[var(--muted)]">
                {forecast.reason === "not_growing"
                  ? t("dashboard.cacheForecast.notGrowing")
                  : forecast.reason === "disk_usage_unavailable"
                    ? t("dashboard.cacheForecast.diskUnavailable")
                    : t("dashboard.cacheForecast.notEnoughData")}
              </p>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  {t("dashboard.cacheForecast.fullIn")}{" "}
                  <span className="font-semibold">
                    {approx.value} {t(`dashboard.cacheForecast.unit.${approx.unit}` as const)}
                  </span>
                </p>
                <p className="text-[var(--muted)]">
                  {formatBytes(forecast.growth_bytes_per_day ?? 0)}
                  {t("dashboard.cacheForecast.perDay")}
                  {" · "}
                  {forecast.percent_used?.toFixed(0)}% {t("dashboard.cacheForecast.diskUsed")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ),
    };
  }

  if (liveTicker) {
    widgetDefs.liveTicker = {
      title: t("dashboard.liveTicker"),
      node: (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4" /> {t("dashboard.liveTicker")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {liveTicker.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-[var(--muted)]">{t("dashboard.liveTickerEmpty")}</p>
            ) : (
              <div className="flex max-h-72 flex-col divide-y divide-[var(--border)] overflow-y-auto">
                {liveTicker.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-2 text-sm">
                    <div className="flex items-center gap-2.5">
                      <Badge variant={entry.cache_status === "HIT" ? "ok" : "warn"}>
                        {entry.cache_status === "HIT" ? t("dashboard.liveTicker.hit") : t("dashboard.liveTicker.miss")}
                      </Badge>
                      <span className="font-medium capitalize">{SERVICE_LABEL[entry.service] ?? entry.service}</span>
                      <span className="text-[var(--muted)]">{clientLabels[entry.client_ip] ?? entry.client_ip}</span>
                    </div>
                    <span className="text-[var(--muted)]">
                      {formatBytes(entry.bytes)} · {new Date(entry.timestamp).toLocaleTimeString(locale)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ),
    };
  }

  {
    const enoughData = (trends?.length ?? 0) >= 2;
    widgetDefs.trends = {
      title: t("dashboard.trends"),
      node: (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> {t("dashboard.trends")}
              <InfoTooltip text={t("dashboard.trendsTooltip")} />
            </CardTitle>
            <div className="flex gap-1">
              {TRENDS_RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setTrendsRange(r)}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium",
                    trendsRange === r
                      ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                      : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
                  )}
                >
                  {t(`dashboard.trends.range.${r}` as const)}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {trends === null ? (
              <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
            ) : !enoughData ? (
              <p className="text-sm text-[var(--muted)]">{t("dashboard.trendsCollecting")}</p>
            ) : (
              <TrendsChart data={trends} />
            )}
          </CardContent>
        </Card>
      ),
    };
  }

  if (history && history.length > 0) {
    widgetDefs.runHistory = {
      title: t("dashboard.runHistory"),
      node: (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" /> {t("dashboard.runHistory")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="px-5 pb-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder={t("dashboard.runHistorySearchPlaceholder")}
                  className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pl-8 pr-2.5 text-sm outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
            {filteredHistory.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-[var(--muted)]">{t("dashboard.runHistoryNoMatch")}</p>
            ) : (
              <div className="flex flex-col divide-y divide-[var(--border)]">
                {filteredHistory.map((run, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <div className="flex items-center gap-3">
                      <Badge variant={run.exit_code === 0 ? "ok" : "warn"}>
                        {SERVICE_LABEL[run.service] ?? run.service}
                      </Badge>
                      <span className="text-[var(--muted)]">
                        {new Date(run.started_at).toLocaleString(locale)}
                      </span>
                    </div>
                    <span className="text-[var(--muted)]">
                      {run.exit_code === 0 ? t("dashboard.runSuccessful") : `Exit-Code ${run.exit_code}`} ·{" "}
                      {run.duration_seconds.toFixed(1)}s
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ),
    };
  }

  widgetDefs.trafficTimeline = {
    title: t("dashboard.trafficTimeline"),
    node: (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("dashboard.trafficTimeline")}</CardTitle>
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] p-0.5">
            {TRAFFIC_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setTrafficWindow(w)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  trafficWindow === w
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
                )}
              >
                {t(`dashboard.trafficWindow.${w}` as const)}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <TrafficChart data={timeline} />
        </CardContent>
      </Card>
    ),
  };

  widgetDefs.trafficPerService = {
    title: t("dashboard.trafficPerService"),
    node: (
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.trafficPerService")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {services.length === 0 && (
            <p className="text-sm text-[var(--muted)]">{t("dashboard.noActivity")}</p>
          )}
          {services.map((s) => (
            <div key={s.service} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium capitalize">{s.service}</span>
                <span className="text-[var(--muted)]">
                  {formatBytes(s.total_bytes)} · {formatPercent(s.hit_ratio)} {t("dashboard.stat.hitRatio")}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div
                  className="h-full bg-[var(--accent)]"
                  style={{ width: `${Math.max(2, s.hit_ratio * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    ),
  };

  widgetDefs.topClients = {
    title: t("dashboard.topClients"),
    node: (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> {t("dashboard.topClients")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {top_clients.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("dashboard.noClients")}</p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {top_clients.map((c) => {
                const label = clientLabels[c.client_ip];
                const isEditing = editingClientIp === c.client_ip;
                return (
                  <div key={c.client_ip} className="flex items-center justify-between py-2.5 text-sm">
                    <div className="flex items-center gap-3">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            autoFocus
                            value={clientLabelDraft}
                            onChange={(e) => setClientLabelDraft(e.target.value)}
                            placeholder={t("dashboard.clientLabelPlaceholder")}
                            className="h-7 w-36 text-xs"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveClientLabel(c.client_ip);
                              if (e.key === "Escape") setEditingClientIp(null);
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={savingClientLabel}
                            onClick={() => handleSaveClientLabel(c.client_ip)}
                          >
                            {t("dashboard.clientLabelSave")}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => setEditingClientIp(null)}>
                            {t("dashboard.clientLabelCancel")}
                          </Button>
                        </div>
                      ) : (
                        <>
                          {label ? (
                            <span className="flex flex-col">
                              <span className="font-medium">{label}</span>
                              <span className="text-xs text-[var(--muted)]">{c.client_ip}</span>
                            </span>
                          ) : (
                            <Badge variant="neutral">{c.client_ip}</Badge>
                          )}
                          {!isViewer && (
                            <button
                              type="button"
                              aria-label={t("dashboard.clientLabelEdit")}
                              title={t("dashboard.clientLabelEdit")}
                              onClick={() => startEditingClientLabel(c.client_ip)}
                              className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                          <span className="text-[var(--muted)]">
                            {c.requests.toLocaleString(locale)} {t("dashboard.clientRequests")}
                          </span>
                        </>
                      )}
                    </div>
                    <span className="text-[var(--muted)]">
                      {formatBytes(c.total_bytes)}
                      {c.last_seen &&
                        ` · ${t("dashboard.clientLastSeen")} ${new Date(c.last_seen).toLocaleString(locale)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    ),
  };

  widgetDefs.recentActivity = {
    title: t("dashboard.recentActivity"),
    node: (
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.recentActivity")}</CardTitle>
        </CardHeader>
        <CardContent>
          {recent_activity.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("dashboard.noRecentActivity")}</p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {recent_activity.map((a, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge variant="accent">{a.service}</Badge>
                    <span className="text-[var(--muted)]">
                      {new Date(a.bucket_start).toLocaleString(locale)}
                    </span>
                  </div>
                  <span className="text-[var(--muted)]">
                    {a.requests.toLocaleString(locale)} {t("dashboard.clientRequests")} ·{" "}
                    {formatBytes(a.hit_bytes + a.miss_bytes)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ),
  };

  if (upcomingReleases) {
    widgetDefs.upcomingReleases = {
      title: t("dashboard.upcomingReleases"),
      node: (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> {t("dashboard.upcomingReleases")}
              <InfoTooltip text={t("dashboard.upcomingReleasesTooltip")} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingReleases.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("dashboard.upcomingReleases.none")}</p>
            ) : (
              <div className="flex flex-col divide-y divide-[var(--border)]">
                {upcomingReleases.slice(0, 8).map((r) => (
                  <a
                    key={r.app_id}
                    href={r.store_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded px-1 py-2.5 text-sm hover:bg-[var(--surface-2)]"
                  >
                    <img
                      src={r.header_image}
                      alt=""
                      className="h-9 w-16 shrink-0 rounded object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                      }}
                    />
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="shrink-0 text-[var(--muted)]">
                      {new Date(r.release_date).toLocaleDateString(locale, { month: "short", day: "numeric" })}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ),
    };
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-sm text-[var(--muted)]">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={toggleAutoRefresh}
            title={autoRefresh ? t("dashboard.autoRefresh.onHint") : t("dashboard.autoRefresh.offHint")}
          >
            {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {autoRefresh ? t("dashboard.autoRefresh.on") : t("dashboard.autoRefresh.off")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} title={t("dashboard.exportCsv")}>
            <Download className="h-3.5 w-3.5" /> {t("dashboard.exportCsv")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportImage} title={t("dashboard.exportImage")}>
            <ImageIcon className="h-3.5 w-3.5" /> {t("dashboard.exportImage")}
          </Button>
          {customizing && (
            <Button variant="outline" size="sm" onClick={handleResetLayout}>
              {t("dashboard.customize.reset")}
            </Button>
          )}
          <Button variant={customizing ? "default" : "outline"} size="sm" onClick={() => setCustomizing((c) => !c)}>
            <Settings2 className="h-3.5 w-3.5" />
            {customizing ? t("dashboard.customize.done") : t("dashboard.customize")}
          </Button>
        </div>
      </div>

      <OnboardingBanner />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Gauge className="h-4 w-4" />}
          label={t("dashboard.stat.hitRatio")}
          value={formatPercent(overall.hit_ratio)}
          tooltip={t("dashboard.stat.hitRatioTooltip")}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label={t("dashboard.stat.fromCache")}
          value={formatBytes(overall.hit_bytes)}
        />
        <StatCard
          icon={<ArrowDownCircle className="h-4 w-4" />}
          label={t("dashboard.stat.newlyDownloaded")}
          value={formatBytes(overall.miss_bytes)}
        />
        <StatCard
          icon={<Gauge className="h-4 w-4" />}
          label={t("dashboard.stat.totalRequests")}
          value={overall.total_requests.toLocaleString(locale)}
        />
      </div>

      {layout.order.map((id, index) => {
        const def = widgetDefs[id];
        if (!def) return null;
        const isHidden = layout.hidden.includes(id);
        if (!customizing && isHidden) return null;
        return (
          <DashboardWidget
            key={id}
            title={def.title}
            hidden={isHidden}
            customizing={customizing}
            canMoveUp={index > 0}
            canMoveDown={index < layout.order.length - 1}
            onMoveUp={() => moveWidget(id, -1)}
            onMoveDown={() => moveWidget(id, 1)}
            onToggleHidden={() => toggleWidgetHidden(id)}
            moveUpLabel={t("dashboard.customize.moveUp")}
            moveDownLabel={t("dashboard.customize.moveDown")}
            hideLabel={t("dashboard.customize.hide")}
            showLabel={t("dashboard.customize.show")}
            hiddenLabel={t("dashboard.customize.hidden")}
          >
            {def.node}
          </DashboardWidget>
        );
      })}
    </div>
  );
}

function DashboardWidget({
  title,
  hidden,
  customizing,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onToggleHidden,
  moveUpLabel,
  moveDownLabel,
  hideLabel,
  showLabel,
  hiddenLabel,
  children,
}: {
  title: string;
  hidden: boolean;
  customizing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleHidden: () => void;
  moveUpLabel: string;
  moveDownLabel: string;
  hideLabel: string;
  showLabel: string;
  hiddenLabel: string;
  children: ReactNode;
}) {
  if (!customizing) {
    return hidden ? null : <>{children}</>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs">
        <span className="flex items-center gap-2 font-medium">
          {title}
          {hidden && <Badge variant="warn">{hiddenLabel}</Badge>}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={moveUpLabel}
            title={moveUpLabel}
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)] disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={moveDownLabel}
            title={moveDownLabel}
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)] disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={hidden ? showLabel : hideLabel}
            title={hidden ? showLabel : hideLabel}
            onClick={onToggleHidden}
            className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
          >
            {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className={cn(hidden && "pointer-events-none opacity-40")}>{children}</div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          {icon}
        </div>
        <div>
          <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            {label} {tooltip && <InfoTooltip text={tooltip} />}
          </p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DiagnosticIcon({ status }: { status: DiagnosticCheck["status"] }) {
  switch (status) {
    case "ok":
      return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ok)]" />;
    case "warn":
      return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warn)]" />;
    case "fail":
      return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />;
    default:
      return <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" />;
  }
}
