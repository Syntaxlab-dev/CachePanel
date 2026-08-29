const STORAGE_KEY = "cachepanel-theme";

export type Theme = "light" | "dark";

export function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

export function getPreferredTheme(): Theme {
  return getStoredTheme() ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

// A handful of preset accent colors rather than a full color picker for
// every CSS variable -- this is a small self-hosted panel, not a design
// tool, and presets keep every combination guaranteed-readable in both
// light and dark mode (see the matching --accent-swatch-*/[data-accent]
// rules in index.css).
export const ACCENTS = ["blue", "purple", "green", "orange", "pink"] as const;
export type Accent = (typeof ACCENTS)[number];

const ACCENT_STORAGE_KEY = "cachepanel-accent";
const DEFAULT_ACCENT: Accent = "blue";

export function getStoredAccent(): Accent {
  const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
  return (ACCENTS as readonly string[]).includes(stored ?? "") ? (stored as Accent) : DEFAULT_ACCENT;
}

export function applyAccent(accent: Accent) {
  if (accent === DEFAULT_ACCENT) {
    document.documentElement.removeAttribute("data-accent");
  } else {
    document.documentElement.setAttribute("data-accent", accent);
  }
}

export function setAccent(accent: Accent) {
  localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  applyAccent(accent);
}
