import { useEffect, useState } from "react";
import { Clock, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, type ScheduleConfig, type ScheduleWindow, type ServiceSchedule } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const SERVICES: { key: keyof ScheduleConfig; label: string }[] = [
  { key: "steam", label: "Steam" },
  { key: "battlenet", label: "Battle.net" },
  { key: "epic", label: "Epic Games" },
];

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const ALL_DAYS: number[] = [...DAYS];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function toTimeInput(window: ScheduleWindow): string {
  return `${pad(window.hour)}:${pad(window.minute)}`;
}

// A window created in the editor before its first save has no id yet --
// negative, decrementing local-only ids keep each row's React key stable
// across re-renders without colliding with real (positive) backend ids.
let nextLocalId = -1;

function newWindow(): ScheduleWindow {
  return { id: nextLocalId--, hour: 2, minute: 0, days: ALL_DAYS };
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

  function updateWindow(serviceKey: keyof ScheduleConfig, windowId: number, patch: Partial<ScheduleWindow>) {
    setConfig((prev) => {
      if (!prev) return prev;
      const service = prev[serviceKey];
      return {
        ...prev,
        [serviceKey]: {
          ...service,
          windows: service.windows.map((w) => (w.id === windowId ? { ...w, ...patch } : w)),
        },
      };
    });
  }

  function toggleDay(serviceKey: keyof ScheduleConfig, windowId: number, day: number) {
    const window = config?.[serviceKey].windows.find((w) => w.id === windowId);
    if (!window) return;
    const has = window.days.includes(day);
    // Never allow the last remaining day to be unchecked -- a window with
    // zero days would silently never fire, which is more confusing than
    // just not letting it happen in the first place.
    if (has && window.days.length === 1) return;
    const days = has ? window.days.filter((d) => d !== day) : [...window.days, day].sort((a, b) => a - b);
    updateWindow(serviceKey, windowId, { days });
  }

  function addWindow(serviceKey: keyof ScheduleConfig) {
    updateService(serviceKey, { windows: [...(config?.[serviceKey].windows ?? []), newWindow()] });
  }

  function removeWindow(serviceKey: keyof ScheduleConfig, windowId: number) {
    const service = config?.[serviceKey];
    if (!service) return;
    updateService(serviceKey, { windows: service.windows.filter((w) => w.id !== windowId) });
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await api.saveSchedule(config);
      setConfig(updated);
      toast.success(t("schedule.saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.savingFailed"));
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
      <CardContent className="flex flex-col gap-5">
        {!config ? (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        ) : (
          <>
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {SERVICES.map(({ key, label }) => {
                const entry = config[key];
                return (
                  <div key={key} className="flex flex-col gap-3 py-4">
                    <label className="flex items-center gap-2.5 text-sm font-medium">
                      <Checkbox
                        checked={entry.enabled}
                        onCheckedChange={(checked) => updateService(key, { enabled: checked === true })}
                      />
                      {label}
                    </label>

                    <div className={cn("flex flex-col gap-2 pl-1", !entry.enabled && "opacity-40")}>
                      {entry.windows.length === 0 && (
                        <p className="text-xs text-[var(--muted)]">{t("schedule.noWindows")}</p>
                      )}
                      {entry.windows.map((window) => (
                        <div
                          key={window.id}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
                        >
                          <input
                            type="time"
                            value={toTimeInput(window)}
                            disabled={!entry.enabled}
                            onChange={(e) => {
                              const [hour, minute] = e.target.value.split(":").map(Number);
                              if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
                                updateWindow(key, window.id, { hour, minute });
                              }
                            }}
                            className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-sm text-[var(--ink)] disabled:opacity-40"
                          />
                          <div className="flex gap-1">
                            {DAYS.map((day) => (
                              <button
                                key={day}
                                type="button"
                                disabled={!entry.enabled}
                                onClick={() => toggleDay(key, window.id, day)}
                                title={t(`settings.weekday.${day}` as const)}
                                className={cn(
                                  "h-7 w-7 rounded-md text-[11px] font-medium transition-colors disabled:cursor-not-allowed",
                                  window.days.includes(day)
                                    ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                                    : "bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--ink)]"
                                )}
                              >
                                {t(`schedule.weekdayShort.${day}` as const)}
                              </button>
                            ))}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={!entry.enabled}
                            onClick={() => removeWindow(key, window.id)}
                            aria-label={t("schedule.removeWindow")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!entry.enabled}
                        onClick={() => addWindow(key)}
                        className="w-fit"
                      >
                        <Plus className="h-3.5 w-3.5" /> {t("schedule.addWindow")}
                      </Button>
                    </div>
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
