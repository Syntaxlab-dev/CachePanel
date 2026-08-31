import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { AlertCircle, Archive, BarChart3, Bell, CheckCircle2, Copy, Download, Eye, ExternalLink, Fingerprint, Gauge, Heart, Home, Image, Info, KeyRound, LogIn, MessageSquareText, MonitorSmartphone, Moon, Network, Palette, Send, Server, Share2, ShieldCheck, Smartphone, Sparkles, Terminal, Trash2, Tv, Upload, UserPlus, UserCircle2, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScheduleCard } from "@/components/ScheduleCard";
import { InfoTooltip } from "@/components/InfoTooltip";
import { api, type ApiToken, type AppSettingsResponse, type BackupBundle, type ExportBundle, type GrafanaDatasourceCandidate, type PanelRole, type PanelSession, type PanelUser, type UpdateCheckResult, type VersionInfo, type WebauthnCredential } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { ACCENTS, getStoredAccent, setAccent, type Accent } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { isUserCancelled, registerPasskey } from "@/lib/webauthn";

// Six categories groups the ~18 cards below into, replacing one long
// vertical scroll. "integrations" is admin-only content (API tokens, Home
// Assistant), so its tab is filtered out entirely for a viewer rather than
// showing an empty tab -- see SETTINGS_TABS below.
type SettingsTab = "account" | "steam" | "notifications" | "automation" | "integrations" | "appearance";

const SETTINGS_TABS: { id: SettingsTab; icon: LucideIcon; labelKey: string; adminOnly?: boolean }[] = [
  { id: "account", icon: UserCircle2, labelKey: "settings.tab.account" },
  { id: "steam", icon: KeyRound, labelKey: "settings.tab.steam" },
  { id: "notifications", icon: Bell, labelKey: "settings.tab.notifications" },
  { id: "automation", icon: Archive, labelKey: "settings.tab.automation" },
  { id: "integrations", icon: Terminal, labelKey: "settings.tab.integrations", adminOnly: true },
  { id: "appearance", icon: Palette, labelKey: "settings.tab.appearance" },
];

// CommandPalette.tsx jumps here via `/settings#section-xyz` (see its
// goToSettingsSection()) rather than the old direct getElementById() call
// it used to make right after navigating -- that broke the moment cards
// moved into per-tab containers, since a section that isn't in the
// currently active tab was never in a state document.getElementById()
// could find it correctly-visible in. This map lets Settings.tsx's own
// hash effect below activate the right tab FIRST, then scroll -- every
// card keeps every #section-* id it already had, nothing renamed.
const SECTION_TAB_MAP: Record<string, SettingsTab> = {
  "section-users": "account",
  "section-2fa": "account",
  "section-passkeys": "account",
  "section-sessions": "account",
  "section-ip-allowlist": "account",
  "section-notifications": "notifications",
  "section-heartbeat": "notifications",
  "section-ntfy": "notifications",
  "section-webpush": "notifications",
  "section-quiet-hours": "notifications",
  "section-templates": "notifications",
  "section-monthly-budget": "notifications",
  "section-autobackup": "automation",
  "section-sftp-backup": "automation",
  "section-autocleanup": "automation",
  "section-api-tokens": "integrations",
  "section-home-assistant": "integrations",
  "section-grafana-import": "integrations",
  "section-display": "appearance",
};

function initialSettingsTab(): SettingsTab {
  const hash = window.location.hash.replace(/^#/, "");
  return SECTION_TAB_MAP[hash] ?? "account";
}

// PushManager.subscribe()'s applicationServerKey wants a Uint8Array, but
// the backend hands back the VAPID public key as base64url text (see
// webpush_keys.get_public_key_b64()) -- this is the standard conversion
// snippet for that (unpadded base64url -> padded standard base64 -> raw
// bytes), the same one used across basically every Web Push tutorial since
// there's no built-in for it.
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // `new Uint8Array(length)` (unlike Uint8Array.from(), see below) is
  // always backed by a real ArrayBuffer, not the wider ArrayBufferLike
  // (which also covers SharedArrayBuffer) -- PushSubscriptionOptionsInit's
  // applicationServerKey is typed as BufferSource, which only accepts the
  // former, so Uint8Array.from()'s return type fails to compile here even
  // though it would work fine at runtime.
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function Settings() {
  const { t } = useI18n();
  const location = useLocation();
  const { role: myRole, totpEnabled, refresh: refreshAuth } = useAuth();
  const isViewer = myRole === "viewer";
  const isAdmin = myRole === "admin";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialSettingsTab);
  const [accent, setAccentState] = useState<Accent>(() => getStoredAccent());
  const [values, setValues] = useState<AppSettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loginNotice, setLoginNotice] = useState<"success" | "failed" | null>(null);
  const [importing, setImporting] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [testingSftp, setTestingSftp] = useState(false);
  const [importingGrafana, setImportingGrafana] = useState(false);
  const [grafanaDatasourceChoices, setGrafanaDatasourceChoices] = useState<GrafanaDatasourceCandidate[] | null>(
    null,
  );
  const [selectedGrafanaDatasource, setSelectedGrafanaDatasource] = useState("");
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
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [newTokenLabel, setNewTokenLabel] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null);
  const [deletingTokenId, setDeletingTokenId] = useState<number | null>(null);
  const [pendingShareBundle, setPendingShareBundle] = useState<ExportBundle | null>(null);
  const [applyingShareBundle, setApplyingShareBundle] = useState(false);
  const [webpushSupported, setWebpushSupported] = useState(false);
  const [webpushSubscribed, setWebpushSubscribed] = useState(false);
  const [webpushBusy, setWebpushBusy] = useState(false);
  const [testingWebpush, setTestingWebpush] = useState(false);
  const [passkeys, setPasskeys] = useState<WebauthnCredential[] | null>(null);
  const [newPasskeyLabel, setNewPasskeyLabel] = useState("");
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PanelSession[] | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [ipAllowlistText, setIpAllowlistText] = useState("");
  const [savingIpAllowlist, setSavingIpAllowlist] = useState(false);
  const [tokenRateLimitInput, setTokenRateLimitInput] = useState("");
  const [savingTokenRateLimit, setSavingTokenRateLimit] = useState(false);
  const [templatePreviews, setTemplatePreviews] = useState<Record<string, string>>({});
  const [previewingTemplate, setPreviewingTemplate] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  function reloadUsers() {
    api
      .listUsers()
      .then((data) => setUsers(data.users))
      .catch(() => setUsers(null));
  }

  function reloadTokens() {
    api
      .listTokens()
      .then((data) => setTokens(data.tokens))
      .catch(() => setTokens(null));
  }

  function reloadPasskeys() {
    api
      .webauthnListCredentials()
      .then((data) => setPasskeys(data.credentials))
      .catch(() => setPasskeys(null));
  }

  function reloadSessions() {
    api
      .listSessions()
      .then((data) => setSessions(data.sessions))
      .catch(() => setSessions(null));
  }

  useEffect(() => {
    api
      .getSettings()
      .then((data) => {
        setValues(data);
        setIpAllowlistText(data.ip_allowlist.join("\n"));
        setTokenRateLimitInput(String(data.api_token_rate_limit_per_minute));
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("common.unknownError")));
    reloadUsers();
    reloadPasskeys();
    reloadSessions();

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

    // A friend's "share as link" button (see handleShareAsLink below)
    // base64-encodes the same ExportBundle shape GET /api/export already
    // returns into this query param -- decoded here into a pending-review
    // state, NEVER applied automatically just because the link was opened
    // (see the confirm/dismiss banner rendered from pendingShareBundle).
    const shared = params.get("share");
    if (shared) {
      try {
        const json = decodeURIComponent(escape(atob(shared)));
        const bundle = JSON.parse(json) as ExportBundle;
        setPendingShareBundle(bundle);
      } catch {
        toast.error(t("settings.shareLinkInvalid"));
      }
      window.history.replaceState({}, "", "/settings");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Separate from the effect above -- myRole isn't known yet on first
  // render (useAuth()'s own status fetch is still in flight), and only an
  // admin session can reach GET /api/tokens at all (see api_tokens.py),
  // so this waits for that to resolve rather than firing (and failing)
  // eagerly for a viewer or before login state settles.
  useEffect(() => {
    if (isAdmin) reloadTokens();
  }, [isAdmin]);

  // Whether THIS device/browser is currently subscribed -- read straight
  // from the Push API itself (not a backend flag), since that's the one
  // source of truth for "does this specific browser have an active
  // subscription" (the backend only knows the union of all devices, not
  // which one the current page load is running on).
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setWebpushSupported(true);
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => setWebpushSubscribed(!!sub))
      .catch(() => setWebpushSubscribed(false));
  }, []);

  // Activates the right tab for a #section-xyz deep link (e.g. from
  // CommandPalette.tsx or a bookmarked URL) BEFORE scrolling to it -- the
  // element only exists in a visible (non `hidden`) part of the DOM once
  // its tab is active, see SECTION_TAB_MAP above. Depends on
  // location.hash (not just running once on mount) so clicking a
  // different section from the palette while already on /settings, which
  // only changes the hash, still re-triggers this.
  useEffect(() => {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return;
    const tab = SECTION_TAB_MAP[hash];
    if (tab) setActiveTab(tab);
    const timeoutId = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(timeoutId);
  }, [location.hash]);

  async function handleWebpushSubscribe() {
    setWebpushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error(t("settings.webpushPermissionDenied"));
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const { public_key } = await api.webpushVapidPublicKey();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      });
      await api.webpushSubscribe(subscription.toJSON());
      setWebpushSubscribed(true);
      toast.success(t("settings.webpushSubscribedNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.webpushSubscribeFailed"));
    } finally {
      setWebpushBusy(false);
    }
  }

  async function handleWebpushUnsubscribe() {
    setWebpushBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.webpushUnsubscribe(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setWebpushSubscribed(false);
      toast.success(t("settings.webpushUnsubscribedNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.webpushUnsubscribeFailed"));
    } finally {
      setWebpushBusy(false);
    }
  }

  async function handleWebpushTest() {
    setTestingWebpush(true);
    try {
      const result = await api.webpushTest();
      toast.success(`${t("settings.webpushTestSentNotice")} (${result.subscriber_count})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.webpushTestFailed"));
    } finally {
      setTestingWebpush(false);
    }
  }

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

  async function handleRegisterPasskey(e: FormEvent) {
    e.preventDefault();
    const label = newPasskeyLabel.trim();
    if (!label) return;
    setRegisteringPasskey(true);
    try {
      await registerPasskey(label);
      setNewPasskeyLabel("");
      toast.success(t("settings.passkeysAddedNotice"));
      reloadPasskeys();
    } catch (err) {
      if (!isUserCancelled(err)) {
        toast.error(err instanceof Error ? err.message : t("settings.passkeysAddFailed"));
      }
    } finally {
      setRegisteringPasskey(false);
    }
  }

  async function handleDeletePasskey(credentialId: string) {
    setDeletingPasskeyId(credentialId);
    try {
      await api.webauthnDeleteCredential(credentialId);
      toast.success(t("settings.passkeysRemovedNotice"));
      reloadPasskeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.passkeysRemoveFailed"));
    } finally {
      setDeletingPasskeyId(null);
    }
  }

  async function handleRevokeSession(sessionId: string, isCurrent: boolean) {
    if (isCurrent && !window.confirm(t("settings.sessionsRevokeCurrentConfirm"))) return;
    setRevokingSessionId(sessionId);
    try {
      await api.revokeSession(sessionId);
      if (isCurrent) {
        await refreshAuth();
      } else {
        toast.success(t("settings.sessionsRevokedNotice"));
        reloadSessions();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.sessionsRevokeFailed"));
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleSaveIpAllowlist(e: FormEvent) {
    e.preventDefault();
    const entries = ipAllowlistText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // Warn (but don't block -- the operator may be intentionally editing
    // this from a machine other than the one they'll access the panel
    // from) if saving this list would exclude the browser saving it.
    if (entries.length > 0 && values && !window.confirm(
      entries.some((e2) => e2 === values.client_ip)
        ? t("settings.ipAllowlistSaveConfirm")
        : `${t("settings.ipAllowlistSelfExcludeWarning")} (${values.client_ip})\n\n${t("settings.ipAllowlistSaveConfirm")}`,
    )) {
      return;
    }
    setSavingIpAllowlist(true);
    try {
      const updated = await api.saveSettings({ ip_allowlist: entries });
      setValues((prev) => (prev ? { ...prev, ...updated } : prev));
      toast.success(t("settings.savedNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.savingFailed"));
    } finally {
      setSavingIpAllowlist(false);
    }
  }

  async function handleSaveTokenRateLimit(e: FormEvent) {
    e.preventDefault();
    const parsed = Number.parseInt(tokenRateLimitInput, 10);
    if (Number.isNaN(parsed) || parsed < 0) return;
    setSavingTokenRateLimit(true);
    try {
      const updated = await api.saveSettings({ api_token_rate_limit_per_minute: parsed });
      setValues((prev) => (prev ? { ...prev, ...updated } : prev));
      toast.success(t("settings.savedNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.savingFailed"));
    } finally {
      setSavingTokenRateLimit(false);
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

  async function handleCreateToken(e: FormEvent) {
    e.preventDefault();
    const label = newTokenLabel.trim();
    if (!label) return;
    setCreatingToken(true);
    try {
      const result = await api.createToken(label);
      setJustCreatedToken(result.token);
      setNewTokenLabel("");
      reloadTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.apiTokensCreateFailed"));
    } finally {
      setCreatingToken(false);
    }
  }

  async function handleCopyToken() {
    if (!justCreatedToken) return;
    try {
      await navigator.clipboard.writeText(justCreatedToken);
      toast.success(t("settings.apiTokensCopiedNotice"));
    } catch {
      // Clipboard API can fail (permissions, insecure context) -- the raw
      // value stays visible on screen either way, so this is just a lost
      // convenience, not a blocker.
    }
  }

  function buildHaYaml(): string {
    // window.location.origin at generation time -- the user still has to
    // fill in a real token (never generated/shown here, see the API-tokens
    // card above), but the host/port is already correct for wherever this
    // page is actually being viewed from.
    const base = window.location.origin;
    return [
      "sensor:",
      "  - platform: rest",
      "    name: CachePanel",
      `    resource: ${base}/api/ha/sensors`,
      "    headers:",
      '      Authorization: "Bearer DEIN_API_TOKEN"',
      '    value_template: "{{ value_json.hit_ratio_percent }}"',
      "    unit_of_measurement: \"%\"",
      "    json_attributes:",
      "      - bandwidth_saved_gb",
      "      - total_requests",
      "      - disk_percent_used",
      "      - forecast_available",
      "      - hours_until_full",
      "    scan_interval: 300",
    ].join("\n");
  }

  async function handleCopyHaYaml() {
    try {
      await navigator.clipboard.writeText(buildHaYaml());
      toast.success(t("settings.homeAssistantCopied"));
    } catch {
      // see handleCopyToken -- the snippet stays visible on screen either way.
    }
  }

  async function handleDeleteToken(id: number) {
    if (!window.confirm(t("settings.apiTokensDeleteConfirm"))) return;
    setDeletingTokenId(id);
    try {
      await api.deleteToken(id);
      toast.success(t("settings.apiTokensDeleted"));
      reloadTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.apiTokensDeleteFailed"));
    } finally {
      setDeletingTokenId(null);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values) return;
    setSaving(true);
    try {
      const updated = await api.saveSettings(values);
      setValues((prev) => (prev ? { ...prev, ...updated } : prev));
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

  async function handleShareAsLink() {
    try {
      const bundle = await api.exportSelection();
      // unescape/encodeURIComponent round-trip so btoa (which only
      // accepts Latin1) doesn't throw on a manually-entered Epic app name
      // with e.g. an umlaut in it -- see handleApplyShareBundle's mirrored
      // decode below.
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(bundle))));
      const url = `${window.location.origin}/settings?share=${encoded}`;
      await navigator.clipboard.writeText(url);
      toast.success(t("settings.shareLinkCopied"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.shareLinkFailed"));
    }
  }

  async function handleApplyShareBundle() {
    if (!pendingShareBundle) return;
    setApplyingShareBundle(true);
    try {
      await api.importSelection(pendingShareBundle);
      toast.success(t("settings.importedNotice"));
      setPendingShareBundle(null);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `${t("settings.importFailedWithMsgPrefix")} ${err.message}`
          : t("settings.importFailedGeneric"),
      );
    } finally {
      setApplyingShareBundle(false);
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

  async function handleTestSftp() {
    if (!values) return;
    setTestingSftp(true);
    try {
      await api.testSftp({
        host: values.sftp_host,
        port: values.sftp_port,
        username: values.sftp_username,
        password: values.sftp_password,
        private_key: values.sftp_private_key,
        remote_dir: values.sftp_remote_dir,
      });
      toast.success(t("settings.sftpTestOkNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.sftpTestFailed"));
    } finally {
      setTestingSftp(false);
    }
  }

  async function handleImportGrafana(datasourceUid?: string) {
    setImportingGrafana(true);
    try {
      const result = await api.importGrafanaDashboard(datasourceUid);
      if (result.ambiguous) {
        setGrafanaDatasourceChoices(result.candidates);
        return;
      }
      setGrafanaDatasourceChoices(null);
      toast.success(t("settings.grafanaImportOkNotice"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.grafanaImportFailed"));
    } finally {
      setImportingGrafana(false);
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

  async function handlePreviewTemplate(eventKey: string) {
    const template = values?.notification_templates?.[eventKey] ?? "";
    if (!template.trim()) return;
    setPreviewingTemplate(eventKey);
    try {
      const result = await api.previewNotificationTemplate(eventKey as never, template);
      setTemplatePreviews((prev) => ({ ...prev, [eventKey]: result.preview }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.templatesPreviewFailed"));
    } finally {
      setPreviewingTemplate(null);
    }
  }

  function setTemplateValue(eventKey: string, template: string) {
    if (!values) return;
    setValues({ ...values, notification_templates: { ...values.notification_templates, [eventKey]: template } });
  }

  async function handleSaveDisplayToggle() {
    if (!values) return;
    setSavingDisplayToggle(true);
    try {
      const updated = await api.saveSettings({
        public_display_enabled: values.public_display_enabled,
        display_party_name: values.display_party_name,
      });
      setValues((prev) => (prev ? { ...prev, ...updated } : prev));
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

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-px">
        {SETTINGS_TABS.filter((tab) => !tab.adminOnly || isAdmin).map((tab) => {
          const TabIcon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
              )}
            >
              <TabIcon className="h-4 w-4" /> {t(tab.labelKey as Parameters<typeof t>[0])}
            </button>
          );
        })}
      </div>

      <div className={cn("flex flex-col gap-6", activeTab !== "appearance" && "hidden")}>
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
      </div>

      <div className={cn("flex flex-col gap-6", activeTab !== "account" && "hidden")}>
      <Card id="section-users">
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

      <Card id="section-2fa">
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

      <Card id="section-passkeys">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4" /> {t("settings.passkeys")}
            <InfoTooltip text={t("settings.passkeysTooltip")} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-[var(--muted)]">{t("settings.passkeysHint")}</p>

          {passkeys === null ? (
            <p className="text-sm text-[var(--muted)]">{t("settings.passkeysLoadFailed")}</p>
          ) : passkeys.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("settings.passkeysEmpty")}</p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {passkeys.map((pk) => (
                <div key={pk.credential_id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="flex flex-col">
                    <span className="font-medium">{pk.label}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {pk.rp_id} &middot; {new Date(pk.created_date).toLocaleDateString()}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={deletingPasskeyId === pk.credential_id}
                    onClick={() => handleDeletePasskey(pk.credential_id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t("settings.passkeysRemove")}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleRegisterPasskey} className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="new_passkey_label" className="text-sm font-medium">
                {t("settings.passkeysAddLabel")}
              </label>
              <Input
                id="new_passkey_label"
                placeholder={t("settings.passkeysAddPlaceholder")}
                value={newPasskeyLabel}
                onChange={(e) => setNewPasskeyLabel(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={registeringPasskey}>
              <Fingerprint className="h-4 w-4" /> {registeringPasskey ? t("settings.passkeysAdding") : t("settings.passkeysAdd")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card id="section-sessions">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4" /> {t("settings.sessions")}
            <InfoTooltip text={t("settings.sessionsTooltip")} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-[var(--muted)]">{t("settings.sessionsHint")}</p>

          {sessions === null ? (
            <p className="text-sm text-[var(--muted)]">{t("settings.sessionsLoadFailed")}</p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {sessions.map((s) => (
                <div key={s.session_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="flex flex-col">
                    <span className="flex items-center gap-2 font-medium">
                      {s.client_ip}
                      {s.is_current && (
                        <span className="rounded-full border border-[var(--accent)] px-2 py-0.5 text-xs text-[var(--accent)]">
                          {t("settings.sessionsCurrentBadge")}
                        </span>
                      )}
                    </span>
                    <span className="max-w-xs truncate text-xs text-[var(--muted)]" title={s.user_agent}>
                      {s.user_agent || t("settings.sessionsUnknownDevice")}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {t("settings.sessionsLastActivePrefix")} {new Date(s.last_seen_at).toLocaleString()}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={revokingSessionId === s.session_id}
                    onClick={() => handleRevokeSession(s.session_id, s.is_current)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t("settings.sessionsRevoke")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card id="section-ip-allowlist">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-4 w-4" /> {t("settings.ipAllowlist")}
            <InfoTooltip text={t("settings.ipAllowlistTooltip")} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-[var(--muted)]">{t("settings.ipAllowlistHint")}</p>
          {values && (
            <p className="text-xs text-[var(--muted)]">
              {t("settings.ipAllowlistYourIpPrefix")} <code className="font-medium text-[var(--ink)]">{values.client_ip}</code>
            </p>
          )}
          <form onSubmit={handleSaveIpAllowlist} className="flex flex-col gap-3">
            <textarea
              value={ipAllowlistText}
              onChange={(e) => setIpAllowlistText(e.target.value)}
              placeholder={t("settings.ipAllowlistPlaceholder")}
              rows={4}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--ink)]"
            />
            <Button type="submit" disabled={savingIpAllowlist || isViewer} className="self-start">
              {savingIpAllowlist ? t("settings.saving") : t("settings.save")}
            </Button>
          </form>
        </CardContent>
      </Card>
      </div>

      <div className={cn("flex flex-col gap-6", activeTab !== "steam" && "hidden")}>
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
      </div>

      <div className={cn("flex flex-col gap-6", activeTab !== "notifications" && "hidden")}>
      <Card id="section-notifications">
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

              <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-4">
                <label htmlFor="traffic_alert_threshold_gb" className="text-sm font-medium">
                  {t("settings.trafficAlertLabel")}
                </label>
                <Input
                  id="traffic_alert_threshold_gb"
                  type="number"
                  min={0}
                  step={0.5}
                  className="max-w-32"
                  value={values.traffic_alert_threshold_gb}
                  onChange={(e) =>
                    setValues({ ...values, traffic_alert_threshold_gb: Number(e.target.value) || 0 })
                  }
                  disabled={isViewer}
                />
                <p className="text-xs text-[var(--muted)]">{t("settings.trafficAlertHint")}</p>
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

      <Card id="section-quiet-hours">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Moon className="h-4 w-4" /> {t("settings.quietHours")}
            <InfoTooltip text={t("settings.quietHoursTooltip")} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={values.quiet_hours_enabled}
                  disabled={isViewer}
                  onChange={(e) => setValues({ ...values, quiet_hours_enabled: e.target.checked })}
                />
                {t("settings.quietHoursEnabled")}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="flex items-center gap-2 text-sm">
                  {t("settings.quietHoursStart")}
                  <input
                    type="time"
                    value={`${String(values.quiet_hours_start_hour).padStart(2, "0")}:${String(values.quiet_hours_start_minute).padStart(2, "0")}`}
                    disabled={!values.quiet_hours_enabled || isViewer}
                    onChange={(e) => {
                      const [hour, minute] = e.target.value.split(":").map(Number);
                      if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
                        setValues({ ...values, quiet_hours_start_hour: hour, quiet_hours_start_minute: minute });
                      }
                    }}
                    className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] disabled:opacity-40"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  {t("settings.quietHoursEnd")}
                  <input
                    type="time"
                    value={`${String(values.quiet_hours_end_hour).padStart(2, "0")}:${String(values.quiet_hours_end_minute).padStart(2, "0")}`}
                    disabled={!values.quiet_hours_enabled || isViewer}
                    onChange={(e) => {
                      const [hour, minute] = e.target.value.split(":").map(Number);
                      if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
                        setValues({ ...values, quiet_hours_end_hour: hour, quiet_hours_end_minute: minute });
                      }
                    }}
                    className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] disabled:opacity-40"
                  />
                </label>
              </div>
              <p className="text-xs text-[var(--muted)]">{t("settings.quietHoursHint")}</p>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={isViewer || saving}>
                  {saving ? t("settings.saving") : t("settings.save")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card id="section-templates">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4" /> {t("settings.templates")}
            <InfoTooltip text={t("settings.templatesTooltip")} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {(
                [
                  ["prefill_success", "{service} {duration}"],
                  ["prefill_failure", "{service} {exit_code}"],
                  ["disk_warning", "{percent}"],
                  ["traffic_alert", "{service} {gb_used} {threshold_gb}"],
                  ["weekly_report", "{requests} {hit_ratio} {bandwidth_saved}"],
                ] as const
              ).map(([eventKey, placeholders]) => (
                <div key={eventKey} className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
                  <label htmlFor={`template-${eventKey}`} className="text-sm font-medium">
                    {t(`settings.templateEvent.${eventKey}` as const)}
                  </label>
                  <p className="text-xs text-[var(--muted)]">
                    {t("settings.templatesPlaceholdersLabel")} <code className="text-[var(--ink)]">{placeholders}</code>
                  </p>
                  <textarea
                    id={`template-${eventKey}`}
                    rows={2}
                    value={values.notification_templates?.[eventKey] ?? ""}
                    disabled={isViewer}
                    onChange={(e) => setTemplateValue(eventKey, e.target.value)}
                    placeholder={t("settings.templatesPlaceholderHint")}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!values.notification_templates?.[eventKey]?.trim() || previewingTemplate === eventKey}
                      onClick={() => handlePreviewTemplate(eventKey)}
                    >
                      <Eye className="h-3.5 w-3.5" /> {t("settings.templatesPreview")}
                    </Button>
                  </div>
                  {templatePreviews[eventKey] && (
                    <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)]">
                      {templatePreviews[eventKey]}
                    </p>
                  )}
                </div>
              ))}
              <p className="text-xs text-[var(--muted)]">{t("settings.templatesHint")}</p>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={isViewer || saving}>
                  {saving ? t("settings.saving") : t("settings.save")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card id="section-monthly-budget">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4" /> {t("settings.monthlyBudget")}
            <InfoTooltip text={t("settings.monthlyBudgetTooltip")} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="monthly_budget_gb" className="text-sm font-medium">
                  {t("settings.monthlyBudgetLabel")}
                </label>
                <Input
                  id="monthly_budget_gb"
                  type="number"
                  min={0}
                  step={1}
                  className="max-w-32"
                  value={values.monthly_budget_gb}
                  disabled={isViewer}
                  onChange={(e) => setValues({ ...values, monthly_budget_gb: Number(e.target.value) || 0 })}
                />
                <p className="text-xs text-[var(--muted)]">{t("settings.monthlyBudgetHint")}</p>
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

      <Card id="section-heartbeat">
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

      <Card id="section-ntfy">
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

      <Card id="section-webpush">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> {t("settings.webpush")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-[var(--muted)]">{t("settings.webpushHint")}</p>
          {!webpushSupported ? (
            <p className="text-sm text-[var(--muted)]">{t("settings.webpushUnsupported")}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {webpushSubscribed ? (
                <>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--ok)]">
                    <CheckCircle2 className="h-4 w-4" /> {t("settings.webpushSubscribed")}
                  </span>
                  <Button type="button" variant="outline" size="sm" disabled={webpushBusy} onClick={handleWebpushUnsubscribe}>
                    {webpushBusy ? t("settings.webpushUnsubscribing") : t("settings.webpushUnsubscribe")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={testingWebpush} onClick={handleWebpushTest}>
                    <Send className="h-3.5 w-3.5" />
                    {testingWebpush ? t("settings.webpushTesting") : t("settings.webpushTest")}
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" disabled={webpushBusy} onClick={handleWebpushSubscribe}>
                  {webpushBusy ? t("settings.webpushSubscribing") : t("settings.webpushSubscribe")}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      <div className={cn("flex flex-col gap-6", activeTab !== "automation" && "hidden")}>
      <Card id="section-autobackup">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4" /> {t("settings.autoBackup")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={values.auto_backup_enabled}
                  onChange={(e) => setValues({ ...values, auto_backup_enabled: e.target.checked })}
                  disabled={isViewer}
                />
                {t("settings.autoBackupEnabled")}
              </label>
              <p className="text-xs text-[var(--muted)]">{t("settings.autoBackupHint")}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  aria-label={t("settings.autoBackupWeekday")}
                  value={values.auto_backup_weekday}
                  disabled={!values.auto_backup_enabled || isViewer}
                  onChange={(e) => setValues({ ...values, auto_backup_weekday: Number(e.target.value) })}
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
                  aria-label={t("settings.autoBackupTime")}
                  value={`${String(values.auto_backup_hour).padStart(2, "0")}:${String(values.auto_backup_minute).padStart(2, "0")}`}
                  disabled={!values.auto_backup_enabled || isViewer}
                  onChange={(e) => {
                    const [hour, minute] = e.target.value.split(":").map(Number);
                    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
                      setValues({ ...values, auto_backup_hour: hour, auto_backup_minute: minute });
                    }
                  }}
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] disabled:opacity-40"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="auto_backup_retention" className="text-sm font-medium">
                  {t("settings.autoBackupRetentionLabel")}
                </label>
                <Input
                  id="auto_backup_retention"
                  type="number"
                  min={1}
                  max={100}
                  className="max-w-32"
                  value={values.auto_backup_retention}
                  onChange={(e) =>
                    setValues({ ...values, auto_backup_retention: Number(e.target.value) || 7 })
                  }
                  disabled={isViewer}
                />
                <p className="text-xs text-[var(--muted)]">{t("settings.autoBackupRetentionHint")}</p>
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

      <Card id="section-sftp-backup">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" /> {t("settings.sftpBackup")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={values.sftp_backup_enabled}
                  onChange={(e) => setValues({ ...values, sftp_backup_enabled: e.target.checked })}
                  disabled={isViewer}
                />
                {t("settings.sftpBackupEnabled")}
              </label>
              <p className="text-xs text-[var(--muted)]">{t("settings.sftpBackupHint")}</p>

              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sftp_host" className="text-sm font-medium">
                    {t("settings.sftpHost")}
                  </label>
                  <Input
                    id="sftp_host"
                    placeholder="backup.example.com"
                    value={values.sftp_host}
                    onChange={(e) => setValues({ ...values, sftp_host: e.target.value })}
                    disabled={isViewer}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sftp_port" className="text-sm font-medium">
                    {t("settings.sftpPort")}
                  </label>
                  <Input
                    id="sftp_port"
                    type="number"
                    min={1}
                    max={65535}
                    value={values.sftp_port}
                    onChange={(e) => setValues({ ...values, sftp_port: Number(e.target.value) || 22 })}
                    disabled={isViewer}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="sftp_username" className="text-sm font-medium">
                  {t("settings.sftpUsername")}
                </label>
                <Input
                  id="sftp_username"
                  value={values.sftp_username}
                  onChange={(e) => setValues({ ...values, sftp_username: e.target.value })}
                  disabled={isViewer}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="sftp_password" className="text-sm font-medium">
                  {t("settings.sftpPassword")}
                </label>
                <Input
                  id="sftp_password"
                  type="password"
                  value={values.sftp_password}
                  onChange={(e) => setValues({ ...values, sftp_password: e.target.value })}
                  disabled={isViewer}
                />
                <p className="text-xs text-[var(--muted)]">{t("settings.sftpAuthHint")}</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="sftp_private_key" className="text-sm font-medium">
                  {t("settings.sftpPrivateKey")}
                </label>
                <textarea
                  id="sftp_private_key"
                  rows={4}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  value={values.sftp_private_key}
                  onChange={(e) => setValues({ ...values, sftp_private_key: e.target.value })}
                  disabled={isViewer}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--ink)] disabled:opacity-40"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="sftp_remote_dir" className="text-sm font-medium">
                  {t("settings.sftpRemoteDir")}
                </label>
                <Input
                  id="sftp_remote_dir"
                  value={values.sftp_remote_dir}
                  onChange={(e) => setValues({ ...values, sftp_remote_dir: e.target.value })}
                  disabled={isViewer}
                  className="max-w-64"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="sftp_retention" className="text-sm font-medium">
                  {t("settings.sftpRetentionLabel")}
                </label>
                <Input
                  id="sftp_retention"
                  type="number"
                  min={1}
                  max={100}
                  className="max-w-32"
                  value={values.sftp_retention}
                  onChange={(e) => setValues({ ...values, sftp_retention: Number(e.target.value) || 7 })}
                  disabled={isViewer}
                />
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={isViewer || saving}>
                  {saving ? t("settings.saving") : t("settings.save")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isViewer || testingSftp || !values.sftp_host || !values.sftp_username}
                  onClick={handleTestSftp}
                >
                  <Send className="h-3.5 w-3.5" />
                  {testingSftp ? t("settings.sftpTesting") : t("settings.sftpTest")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card id="section-autocleanup">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" /> {t("settings.autoCleanup")}
            <InfoTooltip text={t("settings.autoCleanupTooltip")} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!values ? (
            <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={values.auto_clean_corruption_enabled}
                  onChange={(e) => setValues({ ...values, auto_clean_corruption_enabled: e.target.checked })}
                  disabled={isViewer}
                />
                {t("settings.autoCleanupEnabled")}
              </label>
              <p className="text-xs text-[var(--muted)]">{t("settings.autoCleanupHint")}</p>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={isViewer || saving}>
                  {saving ? t("settings.saving") : t("settings.save")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
      </div>

      <div className={cn("flex flex-col gap-6", activeTab !== "integrations" && "hidden")}>
      {isAdmin && (
        <Card id="section-api-tokens">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-4 w-4" /> {t("settings.apiTokens")}
              <InfoTooltip text={t("settings.apiTokensTooltip")} />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-xs text-[var(--muted)]">{t("settings.apiTokensHint")}</p>

            <form onSubmit={handleSaveTokenRateLimit} className="flex flex-col gap-1.5 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end sm:gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="token_rate_limit" className="flex items-center gap-1.5 text-sm font-medium">
                  <Gauge className="h-3.5 w-3.5" /> {t("settings.apiTokensRateLimit")}
                  <InfoTooltip text={t("settings.apiTokensRateLimitTooltip")} />
                </label>
                <Input
                  id="token_rate_limit"
                  type="number"
                  min={0}
                  value={tokenRateLimitInput}
                  onChange={(e) => setTokenRateLimitInput(e.target.value)}
                  className="max-w-[10rem]"
                />
              </div>
              <Button type="submit" variant="outline" disabled={savingTokenRateLimit}>
                {savingTokenRateLimit ? t("settings.saving") : t("settings.save")}
              </Button>
            </form>

            {justCreatedToken && (
              <div className="flex flex-col gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3">
                <p className="text-sm font-medium text-[var(--accent)]">{t("settings.apiTokensCreatedNotice")}</p>
                <code className="break-all rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
                  {justCreatedToken}
                </code>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleCopyToken}>
                    {t("settings.apiTokensCopy")}
                  </Button>
                  <p className="text-xs text-[var(--muted)]">{t("settings.apiTokensNeverShownAgain")}</p>
                </div>
              </div>
            )}

            {tokens === null ? (
              <p className="text-sm text-[var(--muted)]">{t("settings.apiTokensLoadFailed")}</p>
            ) : tokens.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("settings.apiTokensEmpty")}</p>
            ) : (
              <div className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                {tokens.map((tok) => (
                  <div key={tok.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="flex flex-col">
                      <span className="font-medium">{tok.label}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {t("settings.apiTokensCreatedPrefix")} {new Date(tok.created_date).toLocaleDateString()}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={deletingTokenId === tok.id}
                      onClick={() => handleDeleteToken(tok.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {t("settings.apiTokensDelete")}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleCreateToken} className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="new_token_label" className="text-sm font-medium">
                  {t("settings.apiTokensNameLabel")}
                </label>
                <Input
                  id="new_token_label"
                  placeholder={t("settings.apiTokensNamePlaceholder")}
                  value={newTokenLabel}
                  onChange={(e) => setNewTokenLabel(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={creatingToken}>
                {creatingToken ? t("settings.apiTokensCreating") : t("settings.apiTokensCreate")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card id="section-home-assistant">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-4 w-4" /> {t("settings.homeAssistant")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-[var(--muted)]">{t("settings.homeAssistantHint")}</p>
            <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs">
              <code>{buildHaYaml()}</code>
            </pre>
            <div>
              <Button type="button" variant="outline" size="sm" onClick={handleCopyHaYaml}>
                <Copy className="h-3.5 w-3.5" /> {t("settings.homeAssistantCopy")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card id="section-grafana-import">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> {t("settings.grafanaImport")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!values ? (
              <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <p className="text-xs text-[var(--muted)]">{t("settings.grafanaImportHint")}</p>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="grafana_url" className="text-sm font-medium">
                    {t("settings.grafanaUrl")}
                  </label>
                  <Input
                    id="grafana_url"
                    placeholder="https://grafana.example.com"
                    value={values.grafana_url}
                    onChange={(e) => setValues({ ...values, grafana_url: e.target.value })}
                    disabled={isViewer}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="grafana_api_key" className="text-sm font-medium">
                    {t("settings.grafanaApiKey")}
                  </label>
                  <Input
                    id="grafana_api_key"
                    type="password"
                    value={values.grafana_api_key}
                    onChange={(e) => setValues({ ...values, grafana_api_key: e.target.value })}
                    disabled={isViewer}
                  />
                  <p className="text-xs text-[var(--muted)]">{t("settings.grafanaApiKeyHint")}</p>
                </div>

                {grafanaDatasourceChoices && (
                  <div className="flex flex-col gap-2 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-soft)] p-3">
                    <p className="text-xs text-[var(--warn)]">{t("settings.grafanaDatasourceAmbiguous")}</p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        aria-label={t("settings.grafanaDatasourceAmbiguous")}
                        value={selectedGrafanaDatasource}
                        onChange={(e) => setSelectedGrafanaDatasource(e.target.value)}
                        className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]"
                      >
                        <option value="" disabled>
                          {t("settings.grafanaDatasourcePick")}
                        </option>
                        {grafanaDatasourceChoices.map((ds) => (
                          <option key={ds.uid} value={ds.uid}>
                            {ds.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!selectedGrafanaDatasource || importingGrafana}
                        onClick={() => handleImportGrafana(selectedGrafanaDatasource)}
                      >
                        {t("settings.grafanaImportButton")}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={isViewer || saving}>
                    {saving ? t("settings.saving") : t("settings.save")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isViewer || importingGrafana || !values.grafana_url || !values.grafana_api_key}
                    onClick={() => handleImportGrafana()}
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                    {importingGrafana ? t("settings.grafanaImporting") : t("settings.grafanaImportButton")}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
      </div>

      <div className={cn("flex flex-col gap-6", activeTab !== "steam" && "hidden")}>
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
            <Button type="button" variant="outline" onClick={handleShareAsLink}>
              <Share2 className="h-4 w-4" /> {t("settings.shareAsLink")}
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

      {pendingShareBundle && (
        <Card className="border-[var(--accent)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Share2 className="h-4 w-4" /> {t("settings.shareLinkPromptTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-[var(--muted)]">{t("settings.shareLinkPromptBody")}</p>
            <p className="text-sm">
              {pendingShareBundle.steam_app_ids.length} {t("settings.shareLinkSteamCount")}
              {" · "}
              {pendingShareBundle.battlenet_codes.length} {t("settings.shareLinkBattlenetCount")}
              {" · "}
              {pendingShareBundle.epic_app_ids.length} {t("settings.shareLinkEpicCount")}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" disabled={isViewer || applyingShareBundle} onClick={handleApplyShareBundle}>
                {applyingShareBundle ? t("settings.importing") : t("settings.shareLinkApply")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setPendingShareBundle(null)}>
                {t("settings.shareLinkDismiss")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      </div>

      <div className={cn("flex flex-col gap-6", activeTab !== "automation" && "hidden")}>
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
      </div>

      <div className={cn("flex flex-col gap-6", activeTab !== "appearance" && "hidden")}>
      <Card id="section-display">
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
              <div className="flex flex-col gap-1.5">
                <label htmlFor="display_party_name" className="text-sm font-medium">
                  {t("settings.publicDisplayPartyName")}
                </label>
                <Input
                  id="display_party_name"
                  value={values.display_party_name}
                  onChange={(e) => setValues({ ...values, display_party_name: e.target.value })}
                  placeholder={t("settings.publicDisplayPartyNamePlaceholder")}
                />
                <p className="text-xs text-[var(--muted)]">{t("settings.publicDisplayPartyNameHint")}</p>
              </div>
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
    </div>
  );
}
