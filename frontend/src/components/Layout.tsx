import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Gamepad2,
  Swords,
  Rocket,
  Database,
  ScrollText,
  Settings as SettingsIcon,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getPreferredTheme, setTheme, type Theme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { CommandPalette } from "@/components/CommandPalette";

export function Layout() {
  const [theme, setThemeState] = useState<Theme>(() => getPreferredTheme());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { logout, role } = useAuth();
  const { t, lang, setLang } = useI18n();
  const isAdmin = role === "admin";

  const NAV_ITEMS = [
    { to: "/", label: t("nav.dashboard"), icon: LayoutDashboard, end: true },
    { to: "/steam", label: t("nav.steam"), icon: Gamepad2 },
    { to: "/battlenet", label: t("nav.battlenet"), icon: Swords },
    { to: "/epic", label: t("nav.epic"), icon: Rocket },
    // Admin-only: the page itself also enforces this (backend returns 403
    // for a viewer), this just avoids advertising a link a viewer can't use.
    ...(isAdmin ? [{ to: "/audit-log", label: t("nav.auditLog"), icon: ScrollText }] : []),
    { to: "/settings", label: t("nav.settings"), icon: SettingsIcon },
  ];

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  const sidebarContent = (
    <>
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
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label={t("shortcuts.close")}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileNavOpen(false)}
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
    </>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--ink)] md:flex-row">
      <KeyboardShortcuts />
      <CommandPalette />

      {/* Mobile top bar: only the desktop sidebar is hidden below md, this
          bar (hamburger + brand) takes its place so there's always a way
          to open navigation on a phone-width viewport. */}
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] p-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-ink)]">
            <Database className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">CachePanel</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Menu"
          className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Backdrop, mobile only, closes the drawer on outside click. */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "z-50 flex w-64 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-4",
          "fixed inset-y-0 left-0 transition-transform duration-200 md:static md:w-60 md:translate-x-0",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent}
      </aside>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
