// PWA service worker for the Next.js app.
//  - cache-first for immutable static assets (/_next/static, icon, pdf worker)
//  - the offline day sheet (/sheet) + its attachments live in their own cache
//  - network-first for everything else (with an offline fallback)
// v5: new app icon — the old one is pinned cache-first and must be dropped.
const CACHE_NAME = "itinerary-v5";
// Separate from CACHE_NAME so a version bump doesn't wipe the offline copy, and
// so signing out can purge the personal data without touching static assets.
// Name is mirrored in SheetSync.tsx, which verifies the sheet actually landed.
const SHEET_CACHE = "itinerary-sheet-v1";
// Stable key: the sheet is fetched both as a navigation and as a background
// fetch(), whose requests differ in headers/mode. Keying on a plain URL (and
// matching with ignoreVary) means either one fills, and either one hits.
const SHEET_KEY = "/sheet";

self.addEventListener("install", () => {
  self.skipWaiting();
});

// Fill SHEET_CACHE from inside the worker itself. The app shell's background
// sync can't do this on the worker's very first session (its fetch races
// clients.claim() and bypasses the uncontrolled worker — on iOS home-screen
// installs, a fresh container, that IS the first session), so activation warms
// the cache directly. Failure is fine: activating offline just means nothing
// to warm from.
async function warmSheet() {
  try {
    const response = await fetch("/sheet", { credentials: "same-origin" });
    if (response.ok && !response.redirected) {
      const cache = await caches.open(SHEET_CACHE);
      await cache.put(SHEET_KEY, response);
    }
  } catch {
    /* offline or logged out — the runtime rule will fill it later */
  }
}

self.addEventListener("activate", (event) => {
  // warmSheet is deliberately NOT inside waitUntil: fetch events aren't
  // delivered while the worker is still activating, so holding activation on a
  // full server render of /sheet would delay interception by seconds exactly
  // when the user is racing toward airplane mode. Fire-and-forget — if the
  // worker is torn down mid-fetch, SheetSync re-warms on the next open.
  warmSheet();
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME && k !== SHEET_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// The app posts this on sign-out and on an account switch — the cached sheet is
// one user's itinerary and must not survive either.
self.addEventListener("message", (event) => {
  if (event.data?.type === "purge-sheet") {
    event.waitUntil(caches.delete(SHEET_CACHE));
  }
});

function isStaticAsset(url) {
  // NB: the pdf.js worker is intentionally NOT cached here. It has a stable URL
  // but versioned content, so cache-first would pin a stale worker and break
  // parsing with an API/Worker version mismatch. It's fetched network-first.
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.png" ||
    url.pathname === "/apple-icon.png" ||
    url.pathname === "/icon-192.png" ||
    url.pathname === "/manifest.webmanifest"
  );
}

const isSheet = (url) => url.pathname === "/sheet";
const isAttachment = (url) => url.pathname.startsWith("/api/attachments/");

/** The cached sheet, whatever request shape asks for it. */
async function cachedSheet() {
  const cache = await caches.open(SHEET_CACHE);
  return cache.match(SHEET_KEY, { ignoreVary: true });
}

/** Last-resort page for an offline navigation with nothing cached yet. */
function offlinePage() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title><body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f4f2;color:#1c1b1f"><div style="text-align:center;padding:32px;max-width:26rem"><div style="font-size:40px" aria-hidden>✈️</div><h1 style="font-size:18px;margin:12px 0 8px">You're offline</h1><p style="font-size:14px;color:#5f5e63;line-height:1.5;margin:0 0 20px">No itinerary is saved on this device yet. Open the app once while online and it will be here from then on, connection or not.</p><a href="/" style="display:inline-block;padding:10px 22px;border-radius:999px;background:#33ab9f;color:#fff;font-size:14px;font-weight:500;text-decoration:none">Try again</a></div></body>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
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

  // The offline sheet and its attachments: network-first, but every success is
  // written to SHEET_CACHE so the last good copy is always on hand.
  if (isSheet(url) || isAttachment(url)) {
    // Attachments key on the path so ?download=1 and the inline view share one
    // entry (they're the same bytes).
    const key = isSheet(url) ? SHEET_KEY : url.pathname;
    event.respondWith(
      fetch(request)
        .then((response) => {
          // `redirected` is the critical guard: an expired session 302s to
          // /login, and caching THAT would replace the offline itinerary with a
          // sign-in page exactly when it's needed.
          if (response.ok && !response.redirected) {
            const clone = response.clone();
            caches.open(SHEET_CACHE).then((cache) => cache.put(key, clone));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHEET_CACHE);
          const cached = await cache.match(key, { ignoreVary: true });
          if (cached) return cached;
          return request.mode === "navigate" ? offlinePage() : new Response("Offline", { status: 503 });
        }),
    );
    return;
  }

  // Network-first for everything else (navigations, /api, RSC payloads).
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        // Reopening the app with no connection lands on the day sheet — the one
        // page that's guaranteed to be complete offline.
        const sheet = await cachedSheet();
        if (sheet) return sheet;
        const home = await caches.match("/");
        if (home) return home;
        return offlinePage();
      }
      return new Response("Offline", { status: 503 });
    }),
  );
});
