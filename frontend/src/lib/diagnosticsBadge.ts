// Tab title prefix + a small red dot drawn onto the favicon at runtime,
// so a diagnostics problem (a failed/warning check on the dashboard) is
// visible at a glance even from a background tab or a taskbar with many
// tabs open. Scoped to the Dashboard page's lifetime -- see the effect in
// Dashboard.tsx that calls set()/clear() -- not a global background
// poller; if a problem starts while you're on another page, you'll see it
// next time you're on the dashboard, not immediately.

const TITLE_PREFIX = "⚠ ";
const ORIGINAL_TITLE = "CachePanel";
const FAVICON_HREF = "/favicon.svg";

let originalFaviconDataUrl: string | null = null;
let badgedFaviconDataUrl: string | null = null;

function getFaviconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]');
}

async function buildBadgedFavicon(): Promise<string | null> {
  try {
    const resp = await fetch(FAVICON_HREF);
    const svgText = await resp.text();
    const img = new Image();
    const svgBlob = new Blob([svgText], { type: "image/svg+xml" });
    const svgUrl = URL.createObjectURL(svgBlob);

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("favicon load failed"));
      img.src = svgUrl;
    });

    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    URL.revokeObjectURL(svgUrl);
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, size, size);
    // Red dot, bottom-right, with a thin background-color ring so it
    // reads clearly against any favicon artwork underneath.
    const r = size * 0.17;
    const cx = size - r - 2;
    const cy = size - r - 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#dc2626";
    ctx.fill();

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export async function setDiagnosticsBadge(): Promise<void> {
  document.title = TITLE_PREFIX + ORIGINAL_TITLE;

  const link = getFaviconLink();
  if (!link) return;

  if (!originalFaviconDataUrl) originalFaviconDataUrl = link.href;
  if (!badgedFaviconDataUrl) badgedFaviconDataUrl = await buildBadgedFavicon();
  if (badgedFaviconDataUrl) link.href = badgedFaviconDataUrl;
}

export function clearDiagnosticsBadge(): void {
  document.title = ORIGINAL_TITLE;
  const link = getFaviconLink();
  if (link && originalFaviconDataUrl) link.href = originalFaviconDataUrl;
}
