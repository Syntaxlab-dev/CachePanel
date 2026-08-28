import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Download, KeyRound, LogIn, Upload } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScheduleCard } from "@/components/ScheduleCard";
import { api, type AppSettings, type ExportBundle } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function Settings() {
  const { t } = useI18n();
  const [values, setValues] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loginNotice, setLoginNotice] = useState<"success" | "failed" | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setValues)
      .catch((err) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"));

    const params = new URLSearchParams(window.location.search);
    const loginResult = params.get("steam_login");
    if (loginResult === "success" || loginResult === "failed") {
      setLoginNotice(loginResult);
      window.history.replaceState({}, "", "/settings");
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values) return;
    setSaving(true);
    try {
      const updated = await api.saveSettings(values);
      setValues(updated);
      toast.success("Einstellungen gespeichert.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
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
      a.download = `cachepanel-auswahl-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Auswahl exportiert.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export fehlgeschlagen");
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
      toast.success("Auswahl importiert. Die einzelnen Seiten beim nächsten Öffnen neu geladen.");
    } catch (err) {
      toast.error(
        err instanceof Error ? `Import fehlgeschlagen: ${err.message}` : "Import fehlgeschlagen (ungültige Datei)",
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
            <KeyRound className="h-4 w-4" /> {t("settings.steamCard")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loginNotice === "success" && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--ok)] bg-[var(--ok-soft)] p-3 text-sm text-[var(--ok)]">
              <CheckCircle2 className="h-4 w-4" /> Mit Steam angemeldet — SteamID64 wurde automatisch eingetragen.
            </div>
          )}
          {loginNotice === "failed" && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
              <AlertCircle className="h-4 w-4" /> Steam-Anmeldung fehlgeschlagen, bitte erneut versuchen.
            </div>
          )}

          <a href="/api/auth/steam/login" className="mb-5 block">
            <Button type="button" variant="outline" className="w-full sm:w-auto">
              <LogIn className="h-4 w-4" /> {t("settings.steamLogin")}
            </Button>
          </a>
          <p className="mb-5 text-xs text-[var(--muted)]">
            Trägt deine SteamID64 automatisch ein — den API Key brauchst du trotzdem noch einmal separat
            (Steam vergibt den nicht über den Login).
          </p>

          {!values ? (
            <p className="text-sm text-[var(--muted)]">Lädt…</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="steam_api_key" className="text-sm font-medium">
                  Steam Web API Key
                </label>
                <Input
                  id="steam_api_key"
                  placeholder="z. B. 0B1A19E0856CCF9F7725D992BB42166D"
                  value={values.steam_api_key}
                  onChange={(e) => setValues({ ...values, steam_api_key: e.target.value })}
                />
                <p className="text-xs text-[var(--muted)]">
                  Kostenlos unter{" "}
                  <a
                    href="https://steamcommunity.com/dev/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    steamcommunity.com/dev/apikey
                  </a>{" "}
                  — Domainname ist egal, z. B. „localhost" eintragen.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="steam_id64" className="text-sm font-medium">
                  SteamID64
                </label>
                <Input
                  id="steam_id64"
                  placeholder="z. B. 76561198012345678"
                  value={values.steam_id64}
                  onChange={(e) => setValues({ ...values, steam_id64: e.target.value })}
                />
                <p className="text-xs text-[var(--muted)]">
                  Deine 17-stellige Nutzer-ID, herausfinden z. B. über{" "}
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

      <ScheduleCard />

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.exportImport")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-[var(--muted)]">
            Sichert deine aktuelle Steam-/Battle.net-/Epic-Auswahl als Datei, oder spielt eine zuvor exportierte
            Datei wieder ein (z. B. für eine andere CachePanel-Instanz).
          </p>
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
    </div>
  );
}
