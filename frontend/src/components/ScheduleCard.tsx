import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { api, type ScheduleConfig, type ServiceSchedule } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const SERVICES: { key: keyof ScheduleConfig; label: string }[] = [
  { key: "steam", label: "Steam" },
  { key: "battlenet", label: "Battle.net" },
  { key: "epic", label: "Epic Games" },
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function toTimeInput(entry: ServiceSchedule): string {
  return `${pad(entry.hour)}:${pad(entry.minute)}`;
}

export function ScheduleCard() {
  const { t } = useI18n();
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSchedule().then(setConfig).catch(() => setConfig(null));
  }, []);

  function updateService(key: keyof ScheduleConfig, patch: Partial<ServiceSchedule>) {
    setConfig((prev) => (prev ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await api.saveSchedule(config);
      setConfig(updated);
      toast.success("Zeitplan gespeichert.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4" /> {t("settings.schedule")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-soft)] p-3 text-xs text-[var(--warn)]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Der alte feste Zeitplan (02:00/23:00 Uhr) in den einzelnen Prefill-Containern läuft aktuell parallel
            weiter, bis er manuell deaktiviert wird.
          </span>
        </div>

        {!config ? (
          <p className="text-sm text-[var(--muted)]">Lädt…</p>
        ) : (
          <>
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {SERVICES.map(({ key, label }) => {
                const entry = config[key];
                return (
                  <div key={key} className="flex items-center justify-between gap-4 py-3">
                    <label className="flex items-center gap-2.5 text-sm font-medium">
                      <Checkbox
                        checked={entry.enabled}
                        onCheckedChange={(checked) => updateService(key, { enabled: checked === true })}
                      />
                      {label}
                    </label>
                    <input
                      type="time"
                      value={toTimeInput(entry)}
                      disabled={!entry.enabled}
                      onChange={(e) => {
                        const [hour, minute] = e.target.value.split(":").map(Number);
                        if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
                          updateService(key, { hour, minute });
                        }
                      }}
                      className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] disabled:opacity-40"
                    />
                  </div>
                );
              })}
            </div>
            <Button type="button" onClick={handleSave} disabled={saving} className="w-fit">
              <Save className="h-4 w-4" /> {saving ? t("settings.saving") : t("settings.scheduleSave")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
