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
    "dashboard.topClients": "Top-Clients",
    "dashboard.noClients": "Noch keine Client-Daten aufgezeichnet.",
    "dashboard.clientRequests": "Anfragen",
    "dashboard.diagnostics": "Diagnose",
    "dashboard.diagnostics.loading": "Prüfe…",
    "dashboard.diagnostics.notConfigured": "LANCACHE_IP nicht konfiguriert -- DNS-/Erreichbarkeits-Check übersprungen.",
    "dashboard.cacheIntegrity": "Cache-Integrität",
    "dashboard.cacheIntegrity.scan": "Scannen",
    "dashboard.cacheIntegrity.scanning": "Scannt…",
    "dashboard.cacheIntegrity.clean": "Bereinigen",
    "dashboard.cacheIntegrity.cleaning": "Bereinigt…",
    "dashboard.cacheIntegrity.ok": "Keine beschädigten Dateien gefunden.",
    "dashboard.cacheIntegrity.found": "beschädigte Datei(en) gefunden (0 Byte).",
    "dashboard.cacheIntegrity.notScanned": "Noch nicht gescannt.",
    "dashboard.cacheIntegrity.cleanConfirm": "Die gefundenen 0-Byte-Dateien löschen und lancache neu starten? Kurzer Aussetzer für laufende Downloads möglich.",
    "dashboard.clientLastSeen": "Zuletzt aktiv",
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

    "common.unknownError": "Unbekannter Fehler",
    "common.loading": "Lädt…",
    "common.savingFailed": "Speichern fehlgeschlagen",
    "common.hoursPlayed": "Std. gespielt",
    "common.total": "gesamt",
    "common.selected": "ausgewählt",

    "dashboard.statsError": "Statistiken konnten nicht geladen werden:",
    "dashboard.containerRunning": "läuft",
    "dashboard.containerNotFound": "nicht gefunden",
    "dashboard.clearCacheConfirm":
      "Wirklich den GESAMTEN Cache leeren? Das betrifft alle Dienste (Steam, Battle.net, Epic, ...), nicht nur einen einzelnen -- eine gezielte Teil-Leerung ist technisch nicht sicher möglich. Bereits gecachte Downloads müssten danach erneut aus dem Internet geladen werden.",
    "dashboard.scanFailed": "Scan fehlgeschlagen",
    "dashboard.cleanFailed": "Bereinigung fehlgeschlagen",
    "dashboard.clearCacheFailed": "Cache leeren fehlgeschlagen",
    "dashboard.runSuccessful": "erfolgreich",

    "steam.loadError": "Steam-Bibliothek konnte nicht geladen werden:",
    "steam.goToSettings": "Zu den Einstellungen →",
    "steam.gamesInLibrary": "Spiele in deiner Bibliothek",
    "steam.gamesSavedSuffix": "Spiele gespeichert.",
    "steam.sizesLoaded": "Downloadgrößen geladen.",
    "steam.sizesLoadFailed": "Größen konnten nicht geladen werden",
    "steam.loadingLibrary": "Lade Bibliothek…",

    "battlenet.loadError": "Battle.net-Katalog konnte nicht geladen werden:",
    "battlenet.productsAvailable": "Produkte verfügbar",
    "battlenet.productsSavedSuffix": "Produkte gespeichert.",
    "battlenet.loadingCatalog": "Lade Katalog…",

    "epic.loadError": "Epic-Auswahl konnte nicht geladen werden:",
    "epic.alreadySelected": "Ist schon in der Auswahl.",
    "epic.addedSuffix": "hinzugefügt.",

    "setup.passwordMismatch": "Passwörter stimmen nicht überein.",
    "setup.setupComplete": "Zugang eingerichtet.",
    "setup.setupFailed": "Einrichtung fehlgeschlagen",

    "settings.steamLoginSuccess": "Mit Steam angemeldet — SteamID64 wurde automatisch eingetragen.",
    "settings.steamLoginFailed": "Steam-Anmeldung fehlgeschlagen, bitte erneut versuchen.",
    "settings.steamLoginHint":
      "Trägt deine SteamID64 automatisch ein — den API Key brauchst du trotzdem noch einmal separat (Steam vergibt den nicht über den Login).",
    "settings.steamApiKeyLabel": "Steam Web API Key",
    "settings.steamApiKeyHintPrefix": "Kostenlos unter",
    "settings.steamApiKeyHintSuffix": "— Domainname ist egal, z. B. „localhost“ eintragen.",
    "settings.steamId64Label": "SteamID64",
    "settings.steamId64HintPrefix": "Deine 17-stellige Nutzer-ID, herausfinden z. B. über",
    "settings.savedNotice": "Einstellungen gespeichert.",
    "settings.exportedNotice": "Auswahl exportiert.",
    "settings.exportFailed": "Export fehlgeschlagen",
    "settings.importedNotice": "Auswahl importiert. Die einzelnen Seiten beim nächsten Öffnen neu geladen.",
    "settings.importFailedWithMsgPrefix": "Import fehlgeschlagen:",
    "settings.importFailedGeneric": "Import fehlgeschlagen (ungültige Datei)",
    "settings.exportImportHint":
      "Sichert deine aktuelle Steam-/Battle.net-/Epic-Auswahl als Datei, oder spielt eine zuvor exportierte Datei wieder ein (z. B. für eine andere CachePanel-Instanz).",
    "settings.appearance": "Darstellung",
    "settings.appearanceAccent": "Akzentfarbe",
    "accent.blue": "Blau",
    "accent.purple": "Lila",
    "accent.green": "Grün",
    "accent.orange": "Orange",
    "accent.pink": "Pink",
    "settings.steamgriddbHintPrefix": "Optional — mit einem kostenlosen API-Key von",
    "settings.steamgriddbHintSuffix": "zeigen die Steam- und Battle.net-Listen Cover-Art an.",
    "settings.steamgriddbLabel": "SteamGridDB API-Key",

    "schedule.legacyWarning":
      "Der alte feste Zeitplan (02:00/23:00 Uhr) in den einzelnen Prefill-Containern läuft aktuell parallel weiter, bis er manuell deaktiviert wird.",
    "schedule.saved": "Zeitplan gespeichert.",

    "trafficChart.empty": "Noch keine Aktivität für einen Verlauf aufgezeichnet.",
    "trafficChart.hitSeries": "Aus Cache (Hit)",
    "trafficChart.missSeries": "Neu geladen (Miss)",

    "prefill.started": "Download gestartet",
    "prefill.finishedWithExitPrefix": "Beendet mit Exit-Code",
    "prefill.completed": "Download abgeschlossen.",
    "prefill.exitedWithCodePrefix": "Lief mit Exit-Code",
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
    "dashboard.topClients": "Top clients",
    "dashboard.noClients": "No client data recorded yet.",
    "dashboard.clientRequests": "Requests",
    "dashboard.clientLastSeen": "Last seen",
    "dashboard.diagnostics": "Diagnostics",
    "dashboard.diagnostics.loading": "Checking…",
    "dashboard.diagnostics.notConfigured": "LANCACHE_IP not configured -- DNS/reachability check skipped.",
    "dashboard.cacheIntegrity": "Cache integrity",
    "dashboard.cacheIntegrity.scan": "Scan",
    "dashboard.cacheIntegrity.scanning": "Scanning…",
    "dashboard.cacheIntegrity.clean": "Clean up",
    "dashboard.cacheIntegrity.cleaning": "Cleaning…",
    "dashboard.cacheIntegrity.ok": "No corrupted files found.",
    "dashboard.cacheIntegrity.found": "corrupted file(s) found (0 bytes).",
    "dashboard.cacheIntegrity.notScanned": "Not scanned yet.",
    "dashboard.cacheIntegrity.cleanConfirm": "Delete the found 0-byte files and restart lancache? Brief hiccup possible for active downloads.",
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

    "common.unknownError": "Unknown error",
    "common.loading": "Loading…",
    "common.savingFailed": "Failed to save",
    "common.hoursPlayed": "hrs played",
    "common.total": "total",
    "common.selected": "selected",

    "dashboard.statsError": "Could not load statistics:",
    "dashboard.containerRunning": "running",
    "dashboard.containerNotFound": "not found",
    "dashboard.clearCacheConfirm":
      "Really clear the ENTIRE cache? This affects every service (Steam, Battle.net, Epic, ...), not just one -- a targeted partial clear isn't technically safe. Already-cached downloads would need to be pulled from the internet again afterwards.",
    "dashboard.scanFailed": "Scan failed",
    "dashboard.cleanFailed": "Cleanup failed",
    "dashboard.clearCacheFailed": "Failed to clear cache",
    "dashboard.runSuccessful": "successful",

    "steam.loadError": "Could not load Steam library:",
    "steam.goToSettings": "Go to settings →",
    "steam.gamesInLibrary": "games in your library",
    "steam.gamesSavedSuffix": "games saved.",
    "steam.sizesLoaded": "Download sizes loaded.",
    "steam.sizesLoadFailed": "Could not load sizes",
    "steam.loadingLibrary": "Loading library…",

    "battlenet.loadError": "Could not load Battle.net catalog:",
    "battlenet.productsAvailable": "products available",
    "battlenet.productsSavedSuffix": "products saved.",
    "battlenet.loadingCatalog": "Loading catalog…",

    "epic.loadError": "Could not load Epic selection:",
    "epic.alreadySelected": "Already in the selection.",
    "epic.addedSuffix": "added.",

    "setup.passwordMismatch": "Passwords don't match.",
    "setup.setupComplete": "Login set up.",
    "setup.setupFailed": "Setup failed",

    "settings.steamLoginSuccess": "Signed in with Steam — SteamID64 was filled in automatically.",
    "settings.steamLoginFailed": "Steam sign-in failed, please try again.",
    "settings.steamLoginHint":
      "Fills in your SteamID64 automatically — you'll still need to enter the API key separately (Steam doesn't hand that out via login).",
    "settings.steamApiKeyLabel": "Steam Web API Key",
    "settings.steamApiKeyHintPrefix": "Free at",
    "settings.steamApiKeyHintSuffix": "— the domain name doesn't matter, e.g. enter “localhost”.",
    "settings.steamId64Label": "SteamID64",
    "settings.steamId64HintPrefix": "Your 17-digit user ID, look it up e.g. via",
    "settings.savedNotice": "Settings saved.",
    "settings.exportedNotice": "Selection exported.",
    "settings.exportFailed": "Export failed",
    "settings.importedNotice": "Selection imported. Individual pages reload next time they're opened.",
    "settings.importFailedWithMsgPrefix": "Import failed:",
    "settings.importFailedGeneric": "Import failed (invalid file)",
    "settings.exportImportHint":
      "Backs up your current Steam/Battle.net/Epic selection as a file, or restores a previously exported file (e.g. for another CachePanel instance).",
    "settings.appearance": "Appearance",
    "settings.appearanceAccent": "Accent color",
    "accent.blue": "Blue",
    "accent.purple": "Purple",
    "accent.green": "Green",
    "accent.orange": "Orange",
    "accent.pink": "Pink",
    "settings.steamgriddbHintPrefix": "Optional — with a free API key from",
    "settings.steamgriddbHintSuffix": "the Steam and Battle.net lists show cover art.",
    "settings.steamgriddbLabel": "SteamGridDB API key",

    "schedule.legacyWarning":
      "The old fixed schedule (02:00/23:00) inside the individual prefill containers is still running in parallel until it's manually disabled.",
    "schedule.saved": "Schedule saved.",

    "trafficChart.empty": "No activity recorded yet for a timeline.",
    "trafficChart.hitSeries": "From cache (hit)",
    "trafficChart.missSeries": "Newly downloaded (miss)",

    "prefill.started": "download started",
    "prefill.finishedWithExitPrefix": "Finished with exit code",
    "prefill.completed": "Download complete.",
    "prefill.exitedWithCodePrefix": "Exited with code",
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
