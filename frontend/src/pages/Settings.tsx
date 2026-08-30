import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Archive, Bell, CheckCircle2, Download, ExternalLink, Heart, Image, Info, KeyRound, LogIn, Palette, Send, ShieldCheck, Sparkles, Trash2, Tv, Upload, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScheduleCard } from "@/components/ScheduleCard";
import { api, type AppSettings, type BackupBundle, type ExportBundle, type PanelRole, type PanelUser, type UpdateCheckResult, type VersionInfo } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { ACCENTS, getStoredAccent, setAccent, type Accent } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function Settings() {
  const { t } = useI18n();
  const { role: myRole, totpEnabled, refresh: refreshAuth } = useAuth();
  const isViewer = myRole === "viewer";
  const [accent, setAccentState] = useState<Accent>(() => getStoredAccent());
  const [values, setValues] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loginNotice, setLoginNotice] = useState<"success" | "failed" | null>(null);
  const [importing, setImporting] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [testingNtfy, setTestingNtfy] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [savingDisplayToggle, setSavingDisplayToggle] = useState(false);
  const [users, setUsers] = useState<PanelUser[] | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<PanelRole>("admin");
  const [addingUser, setAddingUser] = useState(false);
  const [removingUser, setRemovingUser] = useState<string | null>(null);
  const [totpSetupSecret, setTotpSetupSecret] = useState<string | null>(null);
  const [totpSetupUri, setTotpSetupUri] = useState<string | null>(null);
  const [totpConfirmCode, setTotpConfirmCode] = useState("");
  const [totpDisablePassword, setTotpDisablePassword] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  function reloadUsers() {
    api
      .listUsers()
      .then((data) => setUsers(data.users))
      .catch(() => setUsers(null));
  }

  useEffect(() => {
    api
      .getSettings()
      .then(setValues)
      .catch((err) => setError(err instanceof Error ? err.message : t("common.unknownError")));
    reloadUsers();

    api.getVersion().then(setVersion).catch(() => setVersion(null));
    // Single one-shot check, not a poller -- see update_check.py's docstring
    // for why (never surface a network hiccup to the user, no background
    // work). Silently stays null on any failure.
    api.checkForUpdate().then(setUpdateCheck).catch(() => setUpdateCheck(null));

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

  async function handleAddUser(e: FormEvent) {
    e.preventDefault();
    setAddingUser(true);
    try {
      await api.addUser(newUsername.trim(), newPassword, newRole);
      setNewUsername("");
      setNewPassword("");
      setNewRole("admin");
      toast.success(t("settings.usersAdded"));
      reloadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.usersAddFailed"));
    } finally {
      setAddingUser(false);
    }
  }

  async function handleTotpSetup() {
    setTotpBusy(true);
    try {
      const result = await api.totpSetup();
      setTotpSetupSecret(result.secret);
      setTotpSetupUri(result.uri);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.twoFactorSetupFailed"));
    } finally {
      setTotpBusy(false);
    }
  }

  async function handleTotpConfirm(e: FormEvent) {
    e.preventDefault();
    setTotpBusy(true);
    try {
      await api.totpConfirm(totpConfirmCode.trim());
      setTotpSetupSecret(null);
      setTotpSetupUri(null);
      setTotpConfirmCode("");
      toast.success(t("settings.twoFactorEnabledNotice"));
      await refreshAuth();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.twoFactorSetupFailed"));
    } finally {
      setTotpBusy(false);
    }
  }

  async function handleTotpDisable(e: FormEvent) {
    e.preventDefault();
    setTotpBusy(true);
    try {
      await api.totpDisable(totpDisablePassword);
      setTotpDisablePassword("");
      toast.success(t("settings.twoFactorDisabledNotice"));
      await refreshAuth();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.twoFactorDisableFailed"));
    } finally {
      setTotpBusy(false);
    }
  }

  async function handleTestNtfy() {
    if (!values?.ntfy_topic) return;
    setTestingNtfy(true);
    try {
      await api.testNtfy(values.ntfy_server_url, values.ntfy_topic);
      toast.success(t("settings.ntfyTestSentNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.ntfyTestFailed"));
    } finally {
      setTestingNtfy(false);
    }
  }

  async function handleRemoveUser(username: string) {
    if (!window.confirm(t("settings.usersRemoveConfirm"))) return;
    setRemovingUser(username);
    try {
      await api.removeUser(username);
      toast.success(t("settings.usersRemoved"));
      reloadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.usersRemoveFailed"));
    } finally {
      setRemovingUser(null);
    }
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

  async function handleSendReportNow() {
    if (!values?.discord_webhook_url) return;
    setSendingReport(true);
    try {
      await api.sendCacheReport(values.discord_webhook_url);
      toast.success(t("settings.reportSentNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.reportSendFailed"));
    } finally {
      setSendingReport(false);
    }
  }

  async function handleSaveDisplayToggle() {
    if (!values) return;
    setSavingDisplayToggle(true);
    try {
      const updated = await api.saveSettings({ public_display_enabled: values.public_display_enabled });
      setValues(updated);
      toast.success(t("settings.publicDisplaySaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.savingFailed"));
    } finally {
      setSavingDisplayToggle(false);
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

  async function handleBackupDownload() {
    try {
      const bundle = await api.getBackup();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cachepanel-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("settings.backupDownloadedNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.backupRestoreFailed"));
    }
  }

  function handleBackupRestoreClick() {
    backupFileInputRef.current?.click();
  }

  async function handleBackupRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setRestoringBackup(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as BackupBundle;
      await api.restoreBackup(bundle);
      toast.success(t("settings.backupRestoredNotice"));
      // Settings/schedule/history all changed server-side -- a reload is
      // simpler and more reliable than re-fetching every piece of state
      // this page (and others, e.g. the dashboard's history) hold locally.
      window.location.reload();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `${t("settings.backupRestoreFailed")} ${err.message}`
          : t("settings.backupRestoreFailed"),
      );
    } finally {
      setRestoringBackup(false);
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
            <Users className="h-4 w-4" /> {t("settings.users")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-[var(--muted)]">{t("settings.usersHint")}</p>

          {users === null ? (
            <p className="text-sm text-[var(--muted)]">{t("settings.usersLoadFailed")}</p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {users.map((u) => (
                <div key={u.username} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{u.username}</span>
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
                      {u.role === "admin" ? t("settings.usersRoleAdmin") : t("settings.usersRoleViewer")}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isViewer || users.length <= 1 || removingUser === u.username}
                    onClick={() => handleRemoveUser(u.username)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t("settings.usersRemove")}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAddUser} className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="new_username" className="text-sm font-medium">
                  {t("settings.usersAddUsername")}
                </label>
                <Input
                  id="new_username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  disabled={isViewer}
                  required
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="new_password" className="text-sm font-medium">
                  {t("settings.usersAddPassword")}
                </label>
                <Input
                  id="new_password"
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={isViewer}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="new_role" className="text-sm font-medium">
                  {t("settings.usersRole")}
                </label>
                <select
                  id="new_role"
                  value={newRole}
                  disabled={isViewer}
                  onChange={(e) => setNewRole(e.target.value as PanelRole)}
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] disabled:opacity-40"
                >
                  <option value="admin">{t("settings.usersRoleAdmin")}</option>
                  <option value="viewer">{t("settings.usersRoleViewer")}</option>
                </select>
              </div>
            </div>
            <Button type="submit" disabled={isViewer || addingUser} className="self-start">
              <UserPlus className="h-4 w-4" /> {addingUser ? t("settings.usersAdding") : t("settings.usersAdd")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> {t("settings.twoFactor")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-[var(--muted)]">{t("settings.twoFactorHint")}</p>

          {totpEnabled ? (
            <form onSubmit={handleTotpDisable} className="flex flex-col gap-3">
              <p className="text-sm font-medium text-[var(--ok)]">{t("settings.twoFactorEnabled")}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="password"
                  placeholder={t("settings.twoFactorDisablePasswordPlaceholder")}
                  value={totpDisablePassword}
                  onChange={(e) => setTotpDisablePassword(e.target.value)}
                  required
                  className="max-w-xs"
                />
                <Button type="submit" variant="outline" disabled={totpBusy}>
                  {totpBusy ? t("settings.twoFactorDisabling") : t("settings.twoFactorDisable")}
                </Button>
              </div>
            </form>
          ) : totpSetupSecret && totpSetupUri ? (
            <form onSubmit={handleTotpConfirm} className="flex flex-col gap-3">
              <p className="text-xs text-[var(--muted)]">{t("settings.twoFactorSecretHint")}</p>
              <code className="break-all rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
                {totpSetupSecret}
              </code>
              <code className="break-all rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs text-[var(--muted)]">
                {totpSetupUri}
              </code>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  inputMode="numeric"
                  placeholder={t("settings.twoFactorConfirmPlaceholder")}
                  value={totpConfirmCode}
                  onChange={(e) => setTotpConfirmCode(e.target.value)}
                  required
                  className="max-w-xs"
                />
                <Button type="submit" disabled={totpBusy}>
                  {totpBusy ? t("settings.twoFactorConfirming") : t("settings.twoFactorConfirm")}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="text-sm text-[var(--muted)]">{t("settings.twoFactorDisabled")}</p>
              <Button type="button" onClick={handleTotpSetup} disabled={totpBusy} className="self-start">
                {t("settings.twoFactorSetup")}
              </Button>
            </>
          )}
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
                <Button type="submit" disabled={isViewer || saving}>
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

              <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={values.report_enabled}
                    onChange={(e) => setValues({ ...values, report_enabled: e.target.checked })}
                  />
                  {t("settings.reportEnabled")}
                </label>
                <p className="text-xs text-[var(--muted)]">{t("settings.reportHint")}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    aria-label={t("settings.reportWeekday")}
                    value={values.report_weekday}
                    disabled={!values.report_enabled}
                    onChange={(e) => setValues({ ...values, report_weekday: Number(e.target.value) })}
                    className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] disabled:opacity-40"
                  >
                    {([0, 1, 2, 3, 4, 5, 6] as const).map((d) => (
                      <option key={d} value={d}>
                        {t(`settings.weekday.${d}` as const)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    aria-label={t("settings.reportTime")}
                    value={`${String(values.report_hour).padStart(2, "0")}:${String(values.report_minute).padStart(2, "0")}`}
                    disabled={!values.report_enabled}
                    onChange={(e) => {
                      const [hour, minute] = e.target.value.split(":").map(Number);
                      if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
                        setValues({ ...values, report_hour: hour, report_minute: minute });
                      }
                    }}
                    className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] disabled:opacity-40"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!values.discord_webhook_url || sendingReport}
                    onClick={handleSendReportNow}
                  >
                    <Send className="h-3.5 w-3.5" />{" "}
                    {sendingReport ? t("settings.reportSending") : t("settings.reportSendNow")}
                  </Button>
                </div>
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
                <Button type="submit" disabled={isViewer || saving}>
                  {saving ? t("settings.saving") : t("settings.save")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-4 w-4" /> {t("settings.heartbeat")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="heartbeat_url" className="text-sm font-medium">
                  {t("settings.heartbeatUrlLabel")}
                </label>
                <Input
                  id="heartbeat_url"
                  placeholder="https://healthchecks.io/ping/..."
                  value={values.heartbeat_url}
                  onChange={(e) => setValues({ ...values, heartbeat_url: e.target.value })}
                  disabled={isViewer}
                />
                <p className="text-xs text-[var(--muted)]">{t("settings.heartbeatHint")}</p>
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={isViewer || saving}>
                  {saving ? t("settings.saving") : t("settings.save")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" /> {t("settings.ntfy")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <p className="text-xs text-[var(--muted)]">{t("settings.ntfyHint")}</p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ntfy_server_url" className="text-sm font-medium">
                  {t("settings.ntfyServerLabel")}
                </label>
                <Input
                  id="ntfy_server_url"
                  value={values.ntfy_server_url}
                  onChange={(e) => setValues({ ...values, ntfy_server_url: e.target.value })}
                  disabled={isViewer}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ntfy_topic" className="text-sm font-medium">
                  {t("settings.ntfyTopicLabel")}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="ntfy_topic"
                    value={values.ntfy_topic}
                    onChange={(e) => setValues({ ...values, ntfy_topic: e.target.value })}
                    disabled={isViewer}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!values.ntfy_topic || testingNtfy}
                    onClick={handleTestNtfy}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {testingNtfy ? t("settings.ntfyTesting") : t("settings.ntfyTest")}
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={isViewer || saving}>
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
            <Archive className="h-4 w-4" /> {t("settings.backup")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-[var(--muted)]">{t("settings.backupHint")}</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={handleBackupDownload}>
              <Download className="h-4 w-4" /> {t("settings.backupDownload")}
            </Button>
            <Button type="button" variant="outline" onClick={handleBackupRestoreClick} disabled={restoringBackup}>
              <Upload className="h-4 w-4" /> {restoringBackup ? t("settings.backupRestoring") : t("settings.backupRestore")}
            </Button>
            <input
              ref={backupFileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleBackupRestoreFile}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tv className="h-4 w-4" /> {t("settings.publicDisplay")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={values.public_display_enabled}
                  onChange={(e) => setValues({ ...values, public_display_enabled: e.target.checked })}
                />
                {t("settings.publicDisplayEnabled")}
              </label>
              <p className="text-xs text-[var(--muted)]">{t("settings.publicDisplayHint")}</p>
              <div className="flex items-center gap-2">
                <Button type="button" disabled={isViewer || savingDisplayToggle} onClick={handleSaveDisplayToggle}>
                  {savingDisplayToggle ? t("settings.saving") : t("settings.publicDisplaySave")}
                </Button>
                <Button type="button" variant="outline" onClick={() => window.open("/display", "_blank")}>
                  <ExternalLink className="h-4 w-4" /> {t("settings.publicDisplayOpen")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-4 w-4" /> {t("settings.about")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm text-[var(--muted)]">
          {updateCheck?.checked && updateCheck.update_available && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
              <Sparkles className="h-4 w-4 shrink-0" />
              {t("settings.updateAvailablePrefix")} {updateCheck.latest_sha}
            </div>
          )}
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
