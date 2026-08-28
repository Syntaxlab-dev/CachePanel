import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Gamepad2,
  Swords,
  Rocket,
  Database,
  Settings as SettingsIcon,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getPreferredTheme, setTheme, type Theme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export function Layout() {
  const [theme, setThemeState] = useState<Theme>(() => getPreferredTheme());
  const { logout } = useAuth();
  const { t, lang, setLang } = useI18n();

  const NAV_ITEMS = [
    { to: "/", label: t("nav.dashboard"), icon: LayoutDashboard, end: true },
    { to: "/steam", label: t("nav.steam"), icon: Gamepad2 },
    { to: "/battlenet", label: t("nav.battlenet"), icon: Swords },
    { to: "/epic", label: t("nav.epic"), icon: Rocket },
    { to: "/settings", label: t("nav.settings"), icon: SettingsIcon },
  ];

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <aside className="flex w-60 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-8 flex items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-ink)]">
              <Database className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold tracking-tight">CachePanel</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLang(lang === "de" ? "en" : "de")}
              aria-label="Sprache wechseln / Switch language"
              className="flex h-7 w-9 items-center justify-center rounded-md text-xs font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              {lang === "de" ? "DE" : "EN"}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Zu hellem Modus wechseln" : "Zu dunklem Modus wechseln"}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 px-2 pt-4">
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <LogOut className="h-4 w-4" /> {t("nav.logout")}
          </button>
          <a
            href="https://github.com/Syntaxlab-dev/CachePanel"
            target="_blank"
            rel="noreferrer"
            className="px-1 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
          >
            {t("nav.opensource")}
          </a>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
