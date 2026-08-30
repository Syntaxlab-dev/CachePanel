import { useState, type FormEvent } from "react";
import { Database, Fingerprint, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { isPasskeySupported, isUserCancelled, loginWithPasskey } from "@/lib/webauthn";

export function Login() {
  const { t } = useI18n();
  const { refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  async function handlePasskeyLogin() {
    setPasskeyBusy(true);
    try {
      await loginWithPasskey();
      await refresh();
    } catch (err) {
      if (!isUserCancelled(err)) {
        toast.error(err instanceof Error ? err.message : t("login.passkeyFailed"));
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await api.authLogin(username, password);
      if (result.totp_required) {
        // Password already verified server-side -- the session now waits
        // for the second factor, see auth.py's auth_login()/auth_login_totp().
        setTotpRequired(true);
      } else {
        await refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("login.loginFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTotpSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.authLoginTotp(totpCode.trim());
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("login.totpFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4 text-[var(--ink)]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-ink)]">
            <Database className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t("login.title")}</h1>
        </div>

        <Card>
          {totpRequired ? (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> {t("login.totpCardTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleTotpSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="totp_code" className="text-sm font-medium">
                      {t("login.totpCode")}
                    </label>
                    <Input
                      id="totp_code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      required
                    />
                    <p className="text-xs text-[var(--muted)]">{t("login.totpHint")}</p>
                  </div>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? t("login.totpSubmitting") : t("login.totpSubmit")}
                  </Button>
                </form>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LogIn className="h-4 w-4" /> {t("login.cardTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="username" className="text-sm font-medium">
                      {t("login.username")}
                    </label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="password" className="text-sm font-medium">
                      {t("login.password")}
                    </label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? t("login.submitting") : t("login.submit")}
                  </Button>
                </form>
                {isPasskeySupported() && (
                  <>
                    <div className="my-4 flex items-center gap-3 text-xs text-[var(--muted)]">
                      <div className="h-px flex-1 bg-[var(--border)]" />
                      {t("login.orDivider")}
                      <div className="h-px flex-1 bg-[var(--border)]" />
                    </div>
                    <Button type="button" variant="outline" className="w-full" onClick={handlePasskeyLogin} disabled={passkeyBusy}>
                      <Fingerprint className="h-4 w-4" />
                      {passkeyBusy ? t("login.passkeySubmitting") : t("login.passkeyLogin")}
                    </Button>
                  </>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
