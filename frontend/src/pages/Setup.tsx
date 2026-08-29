import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Database, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, type BackupBundle } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export function Setup() {
  const { t } = useI18n();
  const { refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== passwordConfirm) {
      toast.error(t("setup.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    try {
      await api.authSetup(username, password);
      toast.success(t("setup.setupComplete"));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("setup.setupFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleRestoreClick() {
    restoreFileInputRef.current?.click();
  }

  async function handleRestoreFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setRestoring(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as BackupBundle;
      await api.restoreBackup(bundle);
      toast.success(t("setup.restoreComplete"));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? `${t("setup.restoreFailed")} ${err.message}` : t("setup.restoreFailed"));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4 text-[var(--ink)]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-ink)]">
            <Database className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t("setup.title")}</h1>
          <p className="text-sm text-[var(--muted)]">
            {t("setup.subtitle")}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> {t("setup.cardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="username" className="text-sm font-medium">
                  {t("setup.username")}
                </label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-sm font-medium">
                  {t("setup.password")}
                </label>
                <Input
                  id="password"
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className="text-xs text-[var(--muted)]">{t("setup.passwordHint")}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password_confirm" className="text-sm font-medium">
                  {t("setup.passwordConfirm")}
                </label>
                <Input
                  id="password_confirm"
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={submitting}>
                {submitting ? t("setup.submitting") : t("setup.submit")}
              </Button>
            </form>

            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className="mb-2 text-xs text-[var(--muted)]">{t("setup.restoreHint")}</p>
              <Button type="button" variant="outline" className="w-full gap-2" disabled={restoring} onClick={handleRestoreClick}>
                <Upload className="h-4 w-4" /> {restoring ? t("setup.restoring") : t("setup.restoreButton")}
              </Button>
              <input
                ref={restoreFileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleRestoreFile}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
