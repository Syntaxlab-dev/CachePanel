import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TimelinePoint } from "@/lib/api";
import { formatBytes } from "@/lib/utils";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-[var(--shadow)]">
      <p className="mb-1 font-medium text-[var(--ink)]">{formatTime(label)}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ color: entry.color }}>
          {entry.name}: {formatBytes(entry.value)}
        </p>
      ))}
    </div>
  );
}

export function TrafficChart({ data }: { data: TimelinePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-[var(--muted)]">
        Noch keine Aktivität für einen Verlauf aufgezeichnet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="hitGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="missGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--warn)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--warn)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="bucket_start"
          tickFormatter={formatTime}
          stroke="var(--muted)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(v) => formatBytes(v)}
          stroke="var(--muted)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={70}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="hit_bytes"
          name="Aus Cache (Hit)"
          stroke="var(--accent)"
          fill="url(#hitGradient)"
          strokeWidth={2}
          stackId="1"
        />
        <Area
          type="monotone"
          dataKey="miss_bytes"
          name="Neu geladen (Miss)"
          stroke="var(--warn)"
          fill="url(#missGradient)"
          strokeWidth={2}
          stackId="1"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
