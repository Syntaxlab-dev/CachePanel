import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// Global keyboard shortcuts, mounted once in Layout.tsx (so they work from
// any routed page, not just the one that happens to render this file).
// Deliberately no library for this -- a handful of keydown checks doesn't
// need one, consistent with how the rest of this project avoids adding a
// dependency for something this small (see e.g. the dashboard's Up/Down
// tile-reorder buttons instead of a drag&drop library).
export function KeyboardShortcuts() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingG = useRef(false);
  const pendingGTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function isTypingContext(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    }

    function clearPendingG() {
      pendingG.current = false;
      if (pendingGTimeout.current) {
        clearTimeout(pendingGTimeout.current);
        pendingGTimeout.current = null;
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      // Esc always closes the help panel, even while "typing" (e.g. it
      // opened while a search box had focus).
      if (e.key === "Escape" && helpOpen) {
        setHelpOpen(false);
        return;
      }

      if (isTypingContext(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (pendingG.current) {
        clearPendingG();
        if (e.key === "d") {
          e.preventDefault();
          navigate("/");
        } else if (e.key === "s") {
          e.preventDefault();
          navigate("/settings");
        }
        return;
      }

      if (e.key === "g") {
        pendingG.current = true;
        // Short window for the second key of the chord -- if nothing
        // follows, this quietly resets rather than leaving "g" armed
        // indefinitely.
        pendingGTimeout.current = setTimeout(clearPendingG, 800);
        return;
      }

      if (e.key === "/") {
        const searchEl = document.querySelector<HTMLInputElement>("[data-shortcut-search]");
        if (searchEl) {
          e.preventDefault();
          searchEl.focus();
        }
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((open) => !open);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearPendingG();
    };
  }, [navigate, helpOpen]);

  if (!helpOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("shortcuts.helpTitle")}</h2>
          <button
            type="button"
            onClick={() => setHelpOpen(false)}
            aria-label={t("shortcuts.close")}
            className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="flex flex-col gap-2 text-sm">
          {[
            { keys: ["g", "d"], label: t("shortcuts.goDashboard") },
            { keys: ["g", "s"], label: t("shortcuts.goSettings") },
            { keys: ["/"], label: t("shortcuts.focusSearch") },
            { keys: ["?"], label: t("shortcuts.openHelp") },
          ].map(({ keys, label }) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <dt className="text-[var(--muted)]">{label}</dt>
              <dd className="flex items-center gap-1">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs"
                  >
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
