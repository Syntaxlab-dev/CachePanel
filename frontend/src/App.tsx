import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Steam } from "@/pages/Steam";
import { BattleNet } from "@/pages/BattleNet";
import { Epic } from "@/pages/Epic";
import { Settings } from "@/pages/Settings";
import { Setup } from "@/pages/Setup";
import { Login } from "@/pages/Login";
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
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: { background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--border)" },
            }}
          />
          <Gate />
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
