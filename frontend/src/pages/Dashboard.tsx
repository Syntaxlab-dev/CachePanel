import { useEffect, useState } from "react";
import { AlertCircle, ArrowDownCircle, CheckCircle2, Gauge, Server, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type DashboardStats, type HealthStatus } from "@/lib/api";
import { formatBytes, formatPercent, formatUptime } from "@/lib/utils";

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    api
      .dashboardStats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"));
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
        <AlertCircle className="h-4 w-4" /> Statistiken konnten nicht geladen werden: {error}
      </div>
    );
  }

  if (!stats) {
    return <div className="text-sm text-[var(--muted)]">Lade Statistiken…</div>;
  }

  const { overall, services, recent_activity } = stats;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-[var(--muted)]">Überblick über deinen LanCache</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Gauge className="h-4 w-4" />}
          label="Trefferquote"
          value={formatPercent(overall.hit_ratio)}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Aus Cache bedient"
          value={formatBytes(overall.hit_bytes)}
        />
        <StatCard
          icon={<ArrowDownCircle className="h-4 w-4" />}
          label="Neu heruntergeladen"
          value={formatBytes(overall.miss_bytes)}
        />
        <StatCard
          icon={<Gauge className="h-4 w-4" />}
          label="Anfragen gesamt"
          value={overall.total_requests.toLocaleString("de-DE")}
        />
      </div>

      {health && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4" /> Systemstatus
            </CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle>Traffic pro Dienst</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {services.length === 0 && (
            <p className="text-sm text-[var(--muted)]">Noch keine Download-Aktivität aufgezeichnet.</p>
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
          <CardTitle>Letzte Aktivität</CardTitle>
        </CardHeader>
        <CardContent>
          {recent_activity.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Keine Aktivität in den letzten Log-Einträgen.</p>
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
