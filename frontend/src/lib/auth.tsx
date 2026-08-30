import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type PanelRole } from "@/lib/api";

interface AuthState {
  loading: boolean;
  setupRequired: boolean;
  authenticated: boolean;
  role: PanelRole | null;
  totpEnabled: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState<PanelRole | null>(null);
  const [totpEnabled, setTotpEnabled] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const status = await api.authStatus();
      setSetupRequired(status.setup_required);
      setAuthenticated(status.authenticated);
      setRole(status.role);
      setTotpEnabled(status.totp_enabled);
    } catch {
      // Network hiccup -- treat as not-authenticated rather than crash the app.
      setAuthenticated(false);
      setRole(null);
      setTotpEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function logout() {
    await api.authLogout();
    setAuthenticated(false);
    setRole(null);
    setTotpEnabled(false);
  }

  return (
    <AuthContext.Provider value={{ loading, setupRequired, authenticated, role, totpEnabled, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
