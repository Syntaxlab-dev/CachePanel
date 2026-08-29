// Minimal service worker -- exists mainly so browsers consider the app
// installable (Safari/Firefox still gate the install prompt on one being
// registered even though Chromium no longer requires it) and to give
// navigations a cached shell to fall back to if the LAN connection to the
// CachePanel host briefly drops. Deliberately NOT a full offline app: the
// dashboard's actual data always needs a live /api/ call anyway, so there's
// no value in caching API responses here, only the static shell.
const CACHE_NAME = "cachepanel-shell-v1";
const SHELL_URLS = ["/", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Never touch API calls -- always live, never served stale from cache.
  if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/"))),
  );
});
