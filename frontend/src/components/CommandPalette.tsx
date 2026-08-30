import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

// A real searchable launcher (Cmd/Ctrl+K), separate from
// KeyboardShortcuts.tsx's simple g-d/g-s chords and "?" help panel --
// self-contained with its own window keydown listener (rather than routed
// through KeyboardShortcuts.tsx's existing handler, which currently bails
// out early on any metaKey/ctrlKey combo) so the two stay independent and
// neither has to know about the other's internals. Plain substring
// filtering, not a fuzzy-match library -- the entry list here is a few
// dozen items at most, nowhere near where that would matter.
interface PaletteEntry {
  id: string;
  label: string;
  keywords: string;
  run: () => void;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function goToSettingsSection(sectionId: string) {
    // Settings.tsx's own hash effect does the work now (activates the
    // right category tab, THEN scrolls) -- since its cards moved into
    // per-tab containers, a section outside the active tab isn't visible
    // for getElementById()/scrollIntoView() to find, so this can no longer
    // just navigate and blindly scroll itself. Navigating with the hash
    // also correctly re-triggers that effect if we're already on
    // /settings looking at a different tab (React Router's useLocation()
    // updates on a hash-only change, unlike a plain window.location write).
    navigate(`/settings#${sectionId}`);
  }

  const entries: PaletteEntry[] = useMemo(() => {
    const isAdmin = role === "admin";
    const nav: PaletteEntry[] = [
      { id: "nav-dashboard", label: t("nav.dashboard"), keywords: "dashboard overview", run: () => navigate("/") },
      { id: "nav-steam", label: t("nav.steam"), keywords: "steam games", run: () => navigate("/steam") },
      {
        id: "nav-battlenet",
        label: t("nav.battlenet"),
        keywords: "battlenet blizzard",
        run: () => navigate("/battlenet"),
      },
      { id: "nav-epic", label: t("nav.epic"), keywords: "epic games", run: () => navigate("/epic") },
      { id: "nav-settings", label: t("nav.settings"), keywords: "settings config", run: () => navigate("/settings") },
    ];

    const sections: PaletteEntry[] = [
      { id: "section-users", label: t("settings.users"), keywords: "users accounts roles" },
      { id: "section-2fa", label: t("settings.twoFactor"), keywords: "2fa totp two factor mfa" },
      { id: "section-notifications", label: t("settings.notifications"), keywords: "discord webhook alerts" },
      { id: "section-heartbeat", label: t("settings.heartbeat"), keywords: "heartbeat uptime healthchecks" },
      { id: "section-ntfy", label: t("settings.ntfy"), keywords: "ntfy notifications" },
      { id: "section-webpush", label: t("settings.webpush"), keywords: "web push notifications browser pwa" },
      { id: "section-autobackup", label: t("settings.autoBackup"), keywords: "backup schedule automatic" },
      { id: "section-autocleanup", label: t("settings.autoCleanup"), keywords: "cleanup corruption" },
      ...(isAdmin
        ? [
            { id: "section-api-tokens", label: t("settings.apiTokens"), keywords: "api token integration" },
            { id: "section-home-assistant", label: t("settings.homeAssistant"), keywords: "home assistant ha yaml sensor" },
          ]
        : []),
      { id: "section-display", label: t("settings.publicDisplay"), keywords: "lan party display public" },
    ].map((s) => ({ ...s, run: () => goToSettingsSection(s.id) }));

    return [...nav, ...sections];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.label.toLowerCase().includes(q) || e.keywords.includes(q));
  }, [entries, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      const isCombo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCombo) {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered[activeIndex];
      if (entry) {
        entry.run();
        setOpen(false);
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-[var(--muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t("commandPalette.placeholder")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-[var(--muted)]">{t("commandPalette.noResults")}</p>
          ) : (
            filtered.map((entry, i) => (
              <button
                key={entry.id}
                type="button"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => {
                  entry.run();
                  setOpen(false);
                }}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm ${
                  i === activeIndex
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--ink)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {entry.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
