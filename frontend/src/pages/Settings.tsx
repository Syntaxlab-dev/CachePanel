import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, type AppSettings } from "@/lib/api";

export function Settings() {
  const [values, setValues] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(setValues)
      .catch((err) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await api.saveSettings(values);
      setValues(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>
        <p className="text-sm text-[var(--muted)]">
          Deine Zugangsdaten bleiben ausschließlich auf diesem Server gespeichert — sie werden nirgendwo sonst
          hinterlegt oder geteilt.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Steam
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                  {saving ? "Speichert…" : "Speichern"}
                </Button>
                {saved && (
                  <span className="flex items-center gap-1.5 text-sm text-[var(--ok)]">
                    <CheckCircle2 className="h-4 w-4" /> Gespeichert.
                  </span>
                )}
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
  );
}
