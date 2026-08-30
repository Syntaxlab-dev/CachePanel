import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyStat } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
}

function CustomTooltip({ active, payload, label, locale }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-[var(--shadow)]">
      <p className="mb-1 font-medium text-[var(--ink)]">{formatDate(label, locale)}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ color: entry.color }}>
          {entry.name}: {formatBytes(entry.value)}
        </p>
      ))}
    </div>
  );
}

// Same visual language as TrafficChart.tsx (hit/miss split, CSS-variable
// colors so it follows the active theme/accent), bars instead of a
// gradient area since each day is a discrete, independent total rather
// than a continuous timeline.
export function TrendsChart({ data }: { data: DailyStat[] }) {
  const { t, lang } = useI18n();
  const locale = lang === "de" ? "de-DE" : "en-US";

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-[var(--muted)]">
        {t("trendsChart.empty")}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => formatDate(v, locale)}
          stroke="var(--muted)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          minTickGap={30}
        />
        <YAxis
          tickFormatter={(v) => formatBytes(v)}
          stroke="var(--muted)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={70}
        />
        <Tooltip content={<CustomTooltip locale={locale} />} />
        <Bar dataKey="hit_bytes" name={t("trafficChart.hitSeries")} fill="var(--accent)" stackId="1" radius={[2, 2, 0, 0]} />
        <Bar dataKey="miss_bytes" name={t("trafficChart.missSeries")} fill="var(--warn)" stackId="1" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
