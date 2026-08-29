import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Bell, CheckCircle2, Download, Image, Info, KeyRound, LogIn, Palette, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScheduleCard } from "@/components/ScheduleCard";
import { api, type AppSettings, type ExportBundle, type VersionInfo } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ACCENTS, getStoredAccent, setAccent, type Accent } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function Settings() {
  const { t } = useI18n();
  const [accent, setAccentState] = useState<Accent>(() => getStoredAccent());
  const [values, setValues] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loginNotice, setLoginNotice] = useState<"success" | "failed" | null>(null);
  const [importing, setImporting] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setValues)
      .catch((err) => setError(err instanceof Error ? err.message : t("common.unknownError")));

    api.getVersion().then(setVersion).catch(() => setVersion(null));

    const params = new URLSearchParams(window.location.search);
    const loginResult = params.get("steam_login");
    if (loginResult === "success" || loginResult === "failed") {
      setLoginNotice(loginResult);
      window.history.replaceState({}, "", "/settings");
    }
  }, []);

  function handleAccentChange(next: Accent) {
    setAccent(next);
    setAccentState(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values) return;
    setSaving(true);
    try {
      const updated = await api.saveSettings(values);
      setValues(updated);
      toast.success(t("settings.savedNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.savingFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    try {
      const bundle = await api.exportSelection();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cachepanel-selection-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("settings.exportedNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.exportFailed"));
    }
  }

  async function handleTestWebhook() {
    if (!values?.discord_webhook_url) return;
    setTestingWebhook(true);
    try {
      await api.testDiscordWebhook(values.discord_webhook_url);
      toast.success(t("settings.discordTestSentNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.discordTestFailed"));
    } finally {
      setTestingWebhook(false);
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as ExportBundle;
      await api.importSelection(bundle);
      toast.success(t("settings.importedNotice"));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `${t("settings.importFailedWithMsgPrefix")} ${err.message}`
          : t("settings.importFailedGeneric"),
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-[var(--muted)]">
          {t("settings.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" /> {t("settings.appearance")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm font-medium">{t("settings.appearanceAccent")}</p>
          <div className="flex items-center gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => handleAccentChange(a)}
                aria-label={t(`accent.${a}` as const)}
                title={t(`accent.${a}` as const)}
                className={cn(
                  "h-8 w-8 rounded-full border-2 transition-transform",
                  accent === a ? "scale-110 border-[var(--ink)]" : "border-transparent hover:scale-105",
                )}
                style={{ background: `var(--accent-swatch-${a})` }}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> {t("settings.steamCard")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loginNotice === "success" && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--ok)] bg-[var(--ok-soft)] p-3 text-sm text-[var(--ok)]">
              <CheckCircle2 className="h-4 w-4" /> {t("settings.steamLoginSuccess")}
            </div>
          )}
          {loginNotice === "failed" && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
              <AlertCircle className="h-4 w-4" /> {t("settings.steamLoginFailed")}
            </div>
          )}

          <a href="/api/auth/steam/login" className="mb-5 block">
            <Button type="button" variant="outline" className="w-full sm:w-auto">
              <LogIn className="h-4 w-4" /> {t("settings.steamLogin")}
            </Button>
          </a>
          <p className="mb-5 text-xs text-[var(--muted)]">{t("settings.steamLoginHint")}</p>

          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="steam_api_key" className="text-sm font-medium">
                  {t("settings.steamApiKeyLabel")}
                </label>
                <Input
                  id="steam_api_key"
                  placeholder="e.g. 1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D"
                  value={values.steam_api_key}
                  onChange={(e) => setValues({ ...values, steam_api_key: e.target.value })}
                />
                <p className="text-xs text-[var(--muted)]">
                  {t("settings.steamApiKeyHintPrefix")}{" "}
                  <a
                    href="https://steamcommunity.com/dev/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    steamcommunity.com/dev/apikey
                  </a>{" "}
                  {t("settings.steamApiKeyHintSuffix")}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="steam_id64" className="text-sm font-medium">
                  {t("settings.steamId64Label")}
                </label>
                <Input
                  id="steam_id64"
                  placeholder="e.g. 76561198012345678"
                  value={values.steam_id64}
                  onChange={(e) => setValues({ ...values, steam_id64: e.target.value })}
                />
                <p className="text-xs text-[var(--muted)]">
                  {t("settings.steamId64HintPrefix")}{" "}
                  <a
                    href="https://steamid.io"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    steamid.io
                  </a>
                  .
                </p>
              </div>

              <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-4">
                <label htmlFor="steamgriddb_api_key" className="text-sm font-medium">
                  <span className="flex items-center gap-1.5">
                    <Image className="h-3.5 w-3.5" /> {t("settings.steamgriddbLabel")}
                  </span>
                </label>
                <Input
                  id="steamgriddb_api_key"
                  value={values.steamgriddb_api_key}
                  onChange={(e) => setValues({ ...values, steamgriddb_api_key: e.target.value })}
                />
                <p className="text-xs text-[var(--muted)]">
                  {t("settings.steamgriddbHintPrefix")}{" "}
                  <a
                    href="https://www.steamgriddb.com/profile/preferences/api"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    steamgriddb.com
                  </a>{" "}
                  {t("settings.steamgriddbHintSuffix")}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? t("settings.saving") : t("settings.save")}
                </Button>
              </div>
            </form>
          )}

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" /> {t("settings.notifications")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="discord_webhook_url" className="text-sm font-medium">
                  {t("settings.discordWebhookLabel")}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="discord_webhook_url"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={values.discord_webhook_url}
                    onChange={(e) => setValues({ ...values, discord_webhook_url: e.target.value })}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!values.discord_webhook_url || testingWebhook}
                    onClick={handleTestWebhook}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {testingWebhook ? t("settings.discordTesting") : t("settings.discordTest")}
                  </Button>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  {t("settings.discordWebhookHintPrefix")}{" "}
                  <a
                    href="https://support.discord.com/hc/en-us/articles/228383668"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {t("settings.discordWebhookHintLinkText")}
                  </a>
                  . {t("settings.discordWebhookHintSuffix")}
                </p>
              </div>

              <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={values.discord_notify_success}
                    onChange={(e) => setValues({ ...values, discord_notify_success: e.target.checked })}
                  />
                  {t("settings.discordNotifySuccess")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={values.discord_notify_failure}
                    onChange={(e) => setValues({ ...values, discord_notify_failure: e.target.checked })}
                  />
                  {t("settings.discordNotifyFailure")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={values.discord_notify_disk_warning}
                    onChange={(e) => setValues({ ...values, discord_notify_disk_warning: e.target.checked })}
                  />
                  {t("settings.discordNotifyDiskWarning")}
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="run_history_limit" className="text-sm font-medium">
                  {t("settings.runHistoryLimitLabel")}
                </label>
                <Input
                  id="run_history_limit"
                  type="number"
                  min={10}
                  max={500}
                  className="max-w-32"
                  value={values.run_history_limit}
                  onChange={(e) =>
                    setValues({ ...values, run_history_limit: Number(e.target.value) || 50 })
                  }
                />
                <p className="text-xs text-[var(--muted)]">{t("settings.runHistoryLimitHint")}</p>
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? t("settings.saving") : t("settings.save")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <ScheduleCard />

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.exportImport")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-[var(--muted)]">{t("settings.exportImportHint")}</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4" /> {t("settings.export")}
            </Button>
            <Button type="button" variant="outline" onClick={handleImportClick} disabled={importing}>
              <Upload className="h-4 w-4" /> {importing ? t("settings.importing") : t("settings.import")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-4 w-4" /> {t("settings.about")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm text-[var(--muted)]">
          <p>
            {t("settings.aboutVersionPrefix")}:{" "}
            {version?.git_sha_short ? (
              <a
                href={`${version.repo_url}/commit/${version.git_sha}`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {version.git_sha_short}
              </a>
            ) : (
              t("settings.aboutDevBuild")
            )}
          </p>
          <a
            href={version?.repo_url ?? "https://github.com/Syntaxlab-dev/CachePanel"}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {t("settings.aboutRepoLink")}
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
