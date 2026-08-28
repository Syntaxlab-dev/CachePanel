import { createContext, useContext, useState, type ReactNode } from "react";

export type Lang = "de" | "en";

const STORAGE_KEY = "cachepanel-lang";

// Deliberately covers primary UI text (nav, headings, buttons, form
// labels, card titles) rather than every string in the app -- dynamic
// content (toast messages built from live counts, backend error details,
// log output) stays as-is per language. See Wave 3 report for the
// reasoning on this scope cut.
const dictionaries = {
  de: {
    "nav.dashboard": "Dashboard",
    "nav.steam": "Steam",
    "nav.battlenet": "Battle.net",
    "nav.epic": "Epic Games",
    "nav.settings": "Einstellungen",
    "nav.logout": "Abmelden",
    "nav.opensource": "CachePanel — open source",

    "dashboard.title": "Dashboard",
    "dashboard.subtitle": "Überblick über deinen LanCache",
    "dashboard.stat.hitRatio": "Trefferquote",
    "dashboard.stat.fromCache": "Aus Cache bedient",
    "dashboard.stat.newlyDownloaded": "Neu heruntergeladen",
    "dashboard.stat.totalRequests": "Anfragen gesamt",
    "dashboard.systemStatus": "Systemstatus",
    "dashboard.clearCache": "Gesamten Cache leeren",
    "dashboard.clearingCache": "Leert…",
    "dashboard.runHistory": "Download-Verlauf",
    "dashboard.trafficTimeline": "Traffic-Verlauf",
    "dashboard.trafficPerService": "Traffic pro Dienst",
    "dashboard.recentActivity": "Letzte Aktivität",
    "dashboard.noActivity": "Noch keine Download-Aktivität aufgezeichnet.",
    "dashboard.noRecentActivity": "Keine Aktivität in den letzten Log-Einträgen.",
    "dashboard.loading": "Lade Statistiken…",
    "dashboard.onboarding.title": "Noch kein Dienst eingerichtet",
    "dashboard.onboarding.body": "Wähl aus, welche Spiele vorab gecacht werden sollen — Steam braucht kurz deine Zugangsdaten, Battle.net funktioniert sofort.",
    "dashboard.onboarding.steamLink": "Steam einrichten",
    "dashboard.onboarding.battlenetLink": "Battle.net öffnen",
    "dashboard.onboarding.dismiss": "Nicht mehr anzeigen",

    "steam.title": "Steam",
    "steam.search": "Spiel suchen…",
    "steam.sort.name": "A–Z",
    "steam.sort.playtime": "Spielzeit",
    "steam.sort.recent": "Zuletzt gespielt",
    "steam.selectAll": "Alle auswählen",
    "steam.selectAllMatches": "Treffer auswählen",
    "steam.deselectAll": "Alle abwählen",
    "steam.deselectAllMatches": "Treffer abwählen",
    "steam.loadSizes": "Downloadgrößen laden",
    "steam.loadingSizes": "Ermittle Größen…",
    "steam.save": "Auswahl speichern",
    "steam.saving": "Speichert…",
    "steam.noResults": "Keine Treffer",

    "battlenet.title": "Battle.net",
    "battlenet.save": "Auswahl speichern",
    "battlenet.selectAll": "Alle auswählen",
    "battlenet.deselectAll": "Alle abwählen",

    "epic.title": "Epic Games",
    "epic.subtitle": "Epic hat keine öffentliche Bibliotheks-API — App-Namen/IDs manuell eintragen.",
    "epic.addTitle": "App hinzufügen",
    "epic.addPlaceholder": "App-Name oder ID, z. B. Fortnite",
    "epic.add": "Hinzufügen",
    "epic.selected": "Ausgewählt",
    "epic.noneSelected": "Noch keine Apps ausgewählt.",

    "prefill.runNow": "Jetzt herunterladen",
    "prefill.running": "Läuft…",
    "prefill.liveLog": "Live-Log",

    "settings.title": "Einstellungen",
    "settings.subtitle":
      "Deine Zugangsdaten bleiben ausschließlich auf diesem Server gespeichert — sie werden nirgendwo sonst hinterlegt oder geteilt.",
    "settings.steamCard": "Steam",
    "settings.steamLogin": "Mit Steam anmelden",
    "settings.save": "Speichern",
    "settings.saving": "Speichert…",
    "settings.exportImport": "Auswahl exportieren / importieren",
    "settings.export": "Exportieren",
    "settings.import": "Importieren",
    "settings.importing": "Importiert…",
    "settings.schedule": "Zeitplan",
    "settings.scheduleSave": "Zeitplan speichern",

    "setup.title": "CachePanel einrichten",
    "setup.subtitle": "Erster Start — leg einen Zugang fest, der diese Instanz vor Zugriff im Netzwerk schützt.",
    "setup.cardTitle": "Zugangsdaten festlegen",
    "setup.username": "Benutzername",
    "setup.password": "Passwort",
    "setup.passwordHint": "Mindestens 8 Zeichen.",
    "setup.passwordConfirm": "Passwort bestätigen",
    "setup.submit": "Einrichten & anmelden",
    "setup.submitting": "Richtet ein…",

    "login.title": "CachePanel",
    "login.cardTitle": "Anmelden",
    "login.username": "Benutzername",
    "login.password": "Passwort",
    "login.submit": "Anmelden",
    "login.submitting": "Meldet an…",
  },
  en: {
    "nav.dashboard": "Dashboard",
    "nav.steam": "Steam",
    "nav.battlenet": "Battle.net",
    "nav.epic": "Epic Games",
    "nav.settings": "Settings",
    "nav.logout": "Log out",
    "nav.opensource": "CachePanel — open source",

    "dashboard.title": "Dashboard",
    "dashboard.subtitle": "Overview of your LanCache",
    "dashboard.stat.hitRatio": "Hit ratio",
    "dashboard.stat.fromCache": "Served from cache",
    "dashboard.stat.newlyDownloaded": "Newly downloaded",
    "dashboard.stat.totalRequests": "Total requests",
    "dashboard.systemStatus": "System status",
    "dashboard.clearCache": "Clear entire cache",
    "dashboard.clearingCache": "Clearing…",
    "dashboard.runHistory": "Download history",
    "dashboard.trafficTimeline": "Traffic timeline",
    "dashboard.trafficPerService": "Traffic per service",
    "dashboard.recentActivity": "Recent activity",
    "dashboard.noActivity": "No download activity recorded yet.",
    "dashboard.noRecentActivity": "No activity in the recent log entries.",
    "dashboard.loading": "Loading stats…",
    "dashboard.onboarding.title": "No service set up yet",
    "dashboard.onboarding.body": "Choose which games should be pre-cached — Steam needs your credentials first, Battle.net works right away.",
    "dashboard.onboarding.steamLink": "Set up Steam",
    "dashboard.onboarding.battlenetLink": "Open Battle.net",
    "dashboard.onboarding.dismiss": "Don't show again",

    "steam.title": "Steam",
    "steam.search": "Search games…",
    "steam.sort.name": "A–Z",
    "steam.sort.playtime": "Playtime",
    "steam.sort.recent": "Recently played",
    "steam.selectAll": "Select all",
    "steam.selectAllMatches": "Select matches",
    "steam.deselectAll": "Deselect all",
    "steam.deselectAllMatches": "Deselect matches",
    "steam.loadSizes": "Load download sizes",
    "steam.loadingSizes": "Fetching sizes…",
    "steam.save": "Save selection",
    "steam.saving": "Saving…",
    "steam.noResults": "No matches",

    "battlenet.title": "Battle.net",
    "battlenet.save": "Save selection",
    "battlenet.selectAll": "Select all",
    "battlenet.deselectAll": "Deselect all",

    "epic.title": "Epic Games",
    "epic.subtitle": "Epic has no public library API — add app names/IDs manually.",
    "epic.addTitle": "Add app",
    "epic.addPlaceholder": "App name or ID, e.g. Fortnite",
    "epic.add": "Add",
    "epic.selected": "Selected",
    "epic.noneSelected": "No apps selected yet.",

    "prefill.runNow": "Download now",
    "prefill.running": "Running…",
    "prefill.liveLog": "Live log",

    "settings.title": "Settings",
    "settings.subtitle":
      "Your credentials are stored exclusively on this server — never shared or stored anywhere else.",
    "settings.steamCard": "Steam",
    "settings.steamLogin": "Sign in with Steam",
    "settings.save": "Save",
    "settings.saving": "Saving…",
    "settings.exportImport": "Export / import selection",
    "settings.export": "Export",
    "settings.import": "Import",
    "settings.importing": "Importing…",
    "settings.schedule": "Schedule",
    "settings.scheduleSave": "Save schedule",

    "setup.title": "Set up CachePanel",
    "setup.subtitle": "First launch — set up a login that protects this instance from network access.",
    "setup.cardTitle": "Set credentials",
    "setup.username": "Username",
    "setup.password": "Password",
    "setup.passwordHint": "At least 8 characters.",
    "setup.passwordConfirm": "Confirm password",
    "setup.submit": "Set up & sign in",
    "setup.submitting": "Setting up…",

    "login.title": "CachePanel",
    "login.cardTitle": "Sign in",
    "login.username": "Username",
    "login.password": "Password",
    "login.submit": "Sign in",
    "login.submitting": "Signing in…",
  },
} as const;

type Key = keyof (typeof dictionaries)["de"];

function getStoredLang(): Lang | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "de" || stored === "en" ? stored : null;
}

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: Key) => string;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getStoredLang() ?? "de");

  function setLang(next: Lang) {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  }

  function t(key: Key): string {
    return dictionaries[lang][key] ?? dictionaries.de[key] ?? key;
  }

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider");
  return ctx;
}
