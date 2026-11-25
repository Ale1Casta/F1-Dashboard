// F1 Dashboard Service Worker v3
// Network-first for everything; never intercept /api or /ws.
// No pre-caching on install to avoid serving stale assets.

const CACHE_NAME = "f1-dashboard-v3";

self.addEventListener("install", (e) => {
  // Skip waiting so the new SW takes over immediately
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Delete ALL old caches (v1, v2, or any other name)
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never intercept API calls, WebSocket upgrades, or cross-origin resources
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/ws") ||
    e.request.headers.get("upgrade") === "websocket" ||
    url.origin !== self.location.origin
  ) {
    return; // pass through
  }

  // Network-first: always try the network, fall back to cache only if offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache successful responses for offline fallback
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
