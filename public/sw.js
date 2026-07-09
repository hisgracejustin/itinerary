// PWA service worker for the Next.js app.
//  - cache-first for immutable static assets (/_next/static, icon, pdf worker)
//  - network-first for navigations and /api/* (with an offline fallback)
const CACHE_NAME = "itinerary-v3";

self.addEventListener("install", () => {
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

function isStaticAsset(url) {
  // NB: the pdf.js worker is intentionally NOT cached here. It has a stable URL
  // but versioned content, so cache-first would pin a stale worker and break
  // parsing with an API/Worker version mismatch. It's fetched network-first.
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.png" ||
    url.pathname === "/manifest.webmanifest"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.url.startsWith("chrome-extension")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin (e.g. Google/Poe)

  // Cache-first for immutable static assets.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Network-first for everything else (navigations, /api, RSC payloads).
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const home = await caches.match("/");
        if (home) return home;
      }
      return new Response("Offline", { status: 503 });
    }),
  );
});
