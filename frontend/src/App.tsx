import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Steam } from "@/pages/Steam";
import { BattleNet } from "@/pages/BattleNet";
import { Epic } from "@/pages/Epic";
import { Settings } from "@/pages/Settings";
import { AuditLog } from "@/pages/AuditLog";
import { Setup } from "@/pages/Setup";
import { Login } from "@/pages/Login";
import { PublicDisplay } from "@/pages/PublicDisplay";
import { AuthProvider, useAuth } from "@/lib/auth";
import { I18nProvider, useI18n } from "@/lib/i18n";

function Gate() {
  const { loading, setupRequired, authenticated } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--muted)]">
        {t("common.loading")}
      </div>
    );
  }
  if (setupRequired) return <Setup />;
  if (!authenticated) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="steam" element={<Steam />} />
        <Route path="battlenet" element={<BattleNet />} />
        <Route path="epic" element={<Epic />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

// /display is registered here, one level above AuthProvider, so it never
// triggers the login/setup gate (or even the auth-status fetch behind it)
// -- it's the public LAN-party screen (see PublicDisplay.tsx +
// backend/app/routers/public_display.py), meant to work with no session at
// all. Everything else keeps going through the existing authenticated
// Gate() below, unchanged.
function AuthenticatedApp() {
  return (
    <AuthProvider>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--border)" },
        }}
      />
      <Gate />
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <Routes>
          <Route path="/display" element={<PublicDisplay />} />
          <Route path="/*" element={<AuthenticatedApp />} />
        </Routes>
      </I18nProvider>
    </BrowserRouter>
  );
}
