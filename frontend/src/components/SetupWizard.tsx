import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, ChevronRight, Database, Swords, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type AppSettings } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Step = "welcome" | "steam" | "battlenet" | "notifications" | "done";
const STEPS: Step[] = ["welcome", "steam", "battlenet", "notifications", "done"];

// A guided alternative to editing Settings.tsx's cards directly -- reuses
// the exact same api.saveSettings() partial-update call the real Settings
// form uses (see handleSubmit there), so this is pure orchestration, no
// new backend endpoint. Battle.net gets a link instead of its own step:
// the real product catalog lives on its own page (many entries, its own
// search/select UI) and re-implementing that here would just be a worse
// copy of frontend/src/pages/BattleNet.tsx.
export function SetupWizard({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [values, setValues] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then(setValues).catch(() => setValues(null));
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const stepIndex = STEPS.indexOf(step);

  async function persistAndAdvance(partial: Partial<AppSettings>, next: Step) {
    if (!values) {
      setStep(next);
      return;
    }
    setSaving(true);
    try {
      const updated = await api.saveSettings(partial);
      setValues(updated);
      setStep(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.savingFailed"));
    } finally {
      setSaving(false);
    }
  }

  function finish() {
    onClose();
    navigate("/");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-lg flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[var(--accent)]" />
            <span className="text-sm font-medium">{t("wizard.title")}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("wizard.close")}
            className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step !== "welcome" && step !== "done" && (
          <div className="flex gap-1.5 px-5 pt-4">
            {STEPS.slice(1, -1).map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full ${
                  i <= stepIndex - 1 ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                }`}
              />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-4 px-5 py-5">
          {step === "welcome" && (
            <>
              <p className="text-sm text-[var(--ink)]">{t("wizard.welcomeBody")}</p>
              <p className="text-xs text-[var(--muted)]">{t("wizard.welcomeHint")}</p>
            </>
          )}

          {step === "steam" && (
            <>
              <p className="text-sm font-medium">{t("wizard.steamTitle")}</p>
              <p className="text-xs text-[var(--muted)]">{t("wizard.steamBody")}</p>
              {!values ? (
                <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="wizard_steam_api_key" className="text-sm font-medium">
                      {t("settings.steamApiKeyLabel")}
                    </label>
                    <Input
                      id="wizard_steam_api_key"
                      placeholder="e.g. 1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D"
                      value={values.steam_api_key}
                      onChange={(e) => setValues({ ...values, steam_api_key: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="wizard_steam_id64" className="text-sm font-medium">
                      {t("settings.steamId64Label")}
                    </label>
                    <Input
                      id="wizard_steam_id64"
                      placeholder="e.g. 76561198012345678"
                      value={values.steam_id64}
                      onChange={(e) => setValues({ ...values, steam_id64: e.target.value })}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {step === "battlenet" && (
            <>
              <p className="text-sm font-medium">{t("wizard.battlenetTitle")}</p>
              <p className="text-xs text-[var(--muted)]">{t("wizard.battlenetBody")}</p>
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => {
                  onClose();
                  navigate("/battlenet");
                }}
              >
                <Swords className="h-4 w-4" /> {t("wizard.battlenetOpen")}
              </Button>
            </>
          )}

          {step === "notifications" && (
            <>
              <p className="text-sm font-medium">{t("wizard.notificationsTitle")}</p>
              <p className="text-xs text-[var(--muted)]">{t("wizard.notificationsBody")}</p>
              {values && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="wizard_discord_webhook_url" className="text-sm font-medium">
                    {t("settings.discordWebhookLabel")}
                  </label>
                  <Input
                    id="wizard_discord_webhook_url"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={values.discord_webhook_url}
                    onChange={(e) => setValues({ ...values, discord_webhook_url: e.target.value })}
                  />
                </div>
              )}
            </>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium">{t("wizard.doneTitle")}</p>
              <p className="text-xs text-[var(--muted)]">{t("wizard.doneBody")}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3.5">
          {step !== "welcome" && step !== "done" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStep(STEPS[stepIndex - 1])}
              disabled={saving}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> {t("wizard.back")}
            </Button>
          ) : (
            <span />
          )}

          {step === "welcome" && (
            <Button type="button" size="sm" onClick={() => setStep("steam")}>
              {t("wizard.start")} <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {step === "steam" && (
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() =>
                persistAndAdvance(
                  { steam_api_key: values?.steam_api_key, steam_id64: values?.steam_id64 },
                  "battlenet",
                )
              }
            >
              {t("wizard.next")} <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {step === "battlenet" && (
            <Button type="button" size="sm" onClick={() => setStep("notifications")}>
              {t("wizard.next")} <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {step === "notifications" && (
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => persistAndAdvance({ discord_webhook_url: values?.discord_webhook_url }, "done")}
            >
              {t("wizard.next")} <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {step === "done" && (
            <Button type="button" size="sm" onClick={finish}>
              {t("wizard.goToDashboard")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
