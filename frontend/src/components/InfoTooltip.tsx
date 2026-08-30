import { useState } from "react";
import { Info } from "lucide-react";

// A small explainer bubble for a metric/label that isn't self-explanatory
// -- plain CSS/React, no tooltip library. Hover/focus shows it on desktop;
// a click also toggles it so it's reachable on touch devices too (a
// hover-only tooltip is simply unreachable there). Deliberately not a
// portal/floating-ui positioned popover -- these only ever sit next to a
// short label in a normal document flow, so a simple absolutely-positioned
// box relative to the trigger is enough and avoids a new dependency.
export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={text}
        className="text-[var(--muted)] hover:text-[var(--ink)]"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-10 mb-1.5 w-56 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs font-normal text-[var(--ink)] shadow-[var(--shadow)]"
        >
          {text}
        </span>
      )}
    </span>
  );
}
