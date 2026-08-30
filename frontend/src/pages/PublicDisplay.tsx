import { useEffect, useState } from "react";
import { Database, Gauge, HardDrive, Server, Sparkles, Trophy } from "lucide-react";
import { TrafficChart } from "@/components/TrafficChart";
import { fetchPublicDisplayData, type PublicDisplayData } from "@/lib/api";
import { formatBytes, formatDaysApprox, formatPercent } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

// Own poll cadence, independent of the authenticated Dashboard's
// auto-refresh setting (there's no login here to read a preference from) --
// 25s is frequent enough to feel "live" on a party screen without hammering
// a docker-exec-backed disk-usage read every few seconds.
const POLL_INTERVAL_MS = 25_000;

const SERVICE_LABEL: Record<string, string> = {
  steam: "Steam",
  battlenet: "Battle.net",
  epic: "Epic Games",
};

// Fixed dark palette, not the admin's stored light/dark/accent preference
// (theme.ts) -- this screen is meant to look the same on any TV/projector
// regardless of whoever last set a theme on whichever admin device, and a
// party screen should stay legible from across a room either way.
const ACCENT = "#7dd3fc"; // sky-300
const WARN = "#fbbf24"; // amber-400

export function PublicDisplay() {
  const { t, lang } = useI18n();
  const locale = lang === "de" ? "de-DE" : "en-US";
  const [data, setData] = useState<PublicDisplayData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function load() {
      fetchPublicDisplayData()
        .then((result) => {
          if (!cancelled) {
            setData(result);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setData(null);
            setLoaded(true);
          }
        });
    }

    load();
    const id = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d13] text-slate-400">
        {t("common.loading")}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#0a0d13] text-slate-400">
        <Database className="h-10 w-10 opacity-40" />
        <p className="text-lg">{t("display.unavailable")}</p>
      </div>
    );
  }

  const approxForecast =
    data.forecast.available && data.forecast.hours_until_full != null
      ? formatDaysApprox(data.forecast.hours_until_full)
      : null;

  return (
    <div className="min-h-screen bg-[#0a0d13] px-6 py-8 text-slate-100 sm:px-12 sm:py-10">
      <header className="mb-10 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300">
          <Database className="h-7 w-7" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {data.party_name || t("display.title")}
          </h1>
          <p className="text-sm text-slate-500">{data.party_name ? t("display.title") : t("display.subtitle")}</p>
        </div>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatTile
          icon={<Gauge className="h-6 w-6" />}
          label={t("display.hitRatio")}
          value={formatPercent(data.overall.hit_ratio)}
        />
        <StatTile
          icon={<HardDrive className="h-6 w-6" />}
          label={t("display.bandwidthSaved")}
          value={formatBytes(data.overall.bandwidth_saved_bytes)}
        />
        <StatTile
          icon={<Server className="h-6 w-6" />}
          label={t("display.totalRequests")}
          value={data.overall.total_requests.toLocaleString()}
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 lg:col-span-2">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">
            {t("display.trafficTimeline")}
          </h2>
          <TrafficChart data={data.timeline} />
        </div>

        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
              {t("display.perService")}
            </h2>
            <div className="flex flex-col gap-3">
              {data.services.length === 0 ? (
                <p className="text-sm text-slate-500">{t("display.noActivity")}</p>
              ) : (
                data.services.map((s) => {
                  const total = s.hit_bytes + s.miss_bytes;
                  const hitShare = total > 0 ? s.hit_bytes / total : 0;
                  return (
                    <div key={s.service}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{SERVICE_LABEL[s.service] ?? s.service}</span>
                        <span className="text-slate-500">{formatBytes(total)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.round(hitShare * 100)}%`, backgroundColor: ACCENT }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
              {t("display.readyToCache")}
            </h2>
            <div className="flex flex-col gap-2 text-sm">
              <ReadyRow label="Steam" count={data.ready_counts.steam} />
              <ReadyRow label="Battle.net" count={data.ready_counts.battlenet} />
              <ReadyRow label="Epic Games" count={data.ready_counts.epic} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
            {t("display.diskUsage")}
          </h2>
          {data.percent_used != null ? (
            <div className="flex items-center gap-4">
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.round(data.percent_used))}%`,
                    backgroundColor: data.percent_used >= 90 ? WARN : ACCENT,
                  }}
                />
              </div>
              <span className="text-lg font-semibold tabular-nums">{Math.round(data.percent_used)}%</span>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t("display.diskUsageUnavailable")}</p>
          )}
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <Sparkles className="h-5 w-5 shrink-0 text-sky-300" />
          {approxForecast ? (
            <p className="text-sm text-slate-300">
              {t("display.forecastPrefix")}{" "}
              <span className="font-semibold text-slate-100">
                {approxForecast.value} {t(`dashboard.cacheForecast.unit.${approxForecast.unit}` as const)}
              </span>
            </p>
          ) : (
            <p className="text-sm text-slate-500">{t("display.forecastUnavailable")}</p>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-slate-500">
          <Trophy className="h-4 w-4" /> {t("display.records")}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-slate-500">{t("display.recordBandwidth")}</p>
            {data.records.most_bandwidth_saved_date ? (
              <p className="text-lg font-semibold text-slate-100">
                {formatBytes(data.records.most_bandwidth_saved_bytes)}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {new Date(data.records.most_bandwidth_saved_date).toLocaleDateString(locale)}
                </span>
              </p>
            ) : (
              <p className="text-sm text-slate-500">{t("display.recordsNotYet")}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500">{t("display.recordHitRatio")}</p>
            {data.records.highest_hit_ratio_date ? (
              <p className="text-lg font-semibold text-slate-100">
                {formatPercent(data.records.highest_hit_ratio)}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {new Date(data.records.highest_hit_ratio_date).toLocaleDateString(locale)}
                </span>
              </p>
            ) : (
              <p className="text-sm text-slate-500">{t("display.recordsNotYet")}</p>
            )}
          </div>
        </div>
      </div>

      <footer className="mt-10 text-center text-xs text-slate-600">
        {t("display.poweredBy")}{" "}
        <a
          href="https://github.com/Syntaxlab-dev/CachePanel"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          CachePanel
        </a>
      </footer>
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="mb-3 flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-sm font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-4xl font-semibold tabular-nums text-slate-50 sm:text-5xl">{value}</p>
    </div>
  );
}

function ReadyRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold tabular-nums text-slate-100">{count}</span>
    </div>
  );
}
