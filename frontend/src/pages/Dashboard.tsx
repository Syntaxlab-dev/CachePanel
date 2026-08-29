import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDownCircle,
  CheckCircle2,
  Gauge,
  History,
  Server,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrafficChart } from "@/components/TrafficChart";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { api, type DashboardStats, type HealthStatus, type RunHistoryEntry } from "@/lib/api";
import { formatBytes, formatPercent, formatUptime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const SERVICE_LABEL: Record<string, string> = {
  steam: "Steam",
  battlenet: "Battle.net",
  epic: "Epic Games",
};

export function Dashboard() {
  const { t, lang } = useI18n();
  const locale = lang === "de" ? "de-DE" : "en-US";
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [history, setHistory] = useState<RunHistoryEntry[] | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    api
      .dashboardStats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"));
    api.health().then(setHealth).catch(() => setHealth(null));
    api
      .runHistory()
      .then((data) => setHistory(data.runs))
      .catch(() => setHistory(null));
  }, []);

  async function handleClearCache() {
    const confirmed = window.confirm(
      "Wirklich den GESAMTEN Cache leeren? Das betrifft alle Dienste (Steam, Battle.net, Epic, ...), nicht nur einen einzelnen -- eine gezielte Teil-Leerung ist technisch nicht sicher möglich. Bereits gecachte Downloads müssten danach erneut aus dem Internet geladen werden.",
    );
    if (!confirmed) return;

    setClearing(true);
    try {
      const result = await api.clearCache();
      toast.success(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cache leeren fehlgeschlagen");
    } finally {
      setClearing(false);
    }
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
        <AlertCircle className="h-4 w-4" /> Statistiken konnten nicht geladen werden: {error}
      </div>
    );
  }

  if (!stats) {
    return <div className="text-sm text-[var(--muted)]">{t("dashboard.loading")}</div>;
  }

  const { overall, services, recent_activity, timeline, top_clients } = stats;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-sm text-[var(--muted)]">{t("dashboard.subtitle")}</p>
      </div>

      <OnboardingBanner />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Gauge className="h-4 w-4" />}
          label={t("dashboard.stat.hitRatio")}
          value={formatPercent(overall.hit_ratio)}
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
          value={overall.total_requests.toLocaleString("de-DE")}
        />
      </div>

      {health && (
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
                    {running ? "läuft" : c.status === "not_found" ? "nicht gefunden" : c.status}
                    {running && c.uptime_seconds != null && ` · seit ${formatUptime(c.uptime_seconds)}`}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {history && history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" /> {t("dashboard.runHistory")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {history.map((run, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge variant={run.exit_code === 0 ? "ok" : "warn"}>
                      {SERVICE_LABEL[run.service] ?? run.service}
                    </Badge>
                    <span className="text-[var(--muted)]">
                      {new Date(run.started_at).toLocaleString("de-DE")}
                    </span>
                  </div>
                  <span className="text-[var(--muted)]">
                    {run.exit_code === 0 ? "erfolgreich" : `Exit-Code ${run.exit_code}`} ·{" "}
                    {run.duration_seconds.toFixed(1)}s
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.trafficTimeline")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TrafficChart data={timeline} />
        </CardContent>
      </Card>

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
                  {formatBytes(s.total_bytes)} · {formatPercent(s.hit_ratio)} Trefferquote
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
              {top_clients.map((c) => (
                <div key={c.client_ip} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge variant="neutral">{c.client_ip}</Badge>
                    <span className="text-[var(--muted)]">
                      {c.requests.toLocaleString(locale)} {t("dashboard.clientRequests")}
                    </span>
                  </div>
                  <span className="text-[var(--muted)]">
                    {formatBytes(c.total_bytes)}
                    {c.last_seen &&
                      ` · ${t("dashboard.clientLastSeen")} ${new Date(c.last_seen).toLocaleString(locale)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                      {new Date(a.bucket_start).toLocaleString("de-DE")}
                    </span>
                  </div>
                  <span className="text-[var(--muted)]">
                    {a.requests.toLocaleString("de-DE")} Anfragen · {formatBytes(a.hit_bytes + a.miss_bytes)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          {icon}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
