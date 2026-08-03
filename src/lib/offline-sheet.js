/**
 * Offline plumbing that does not require the service worker to be intercepting.
 * iOS home-screen apps have refused to route a fresh install's first-launch
 * navigations through the worker, but the Cache API is readable from any page.
 */

export const SHEET_CACHE = 'itinerary-sheet-v1'

/**
 * Drop the cached sheet and its attachments, from the PAGE.
 *
 * Deliberately not the service worker's `purge-sheet` message: that no-ops
 * whenever there is no controller (no SW support, private mode, a fresh install
 * still racing clients.claim()), and this cache is read straight from the page
 * by readAttachment/handleOfflineSheetClick, so a skipped purge serves the
 * previous account's whole itinerary to the next one. Awaitable for the same
 * reason — callers must not record the purge, or re-cache over it, until the
 * delete has actually landed.
 */
export async function purgeSheetCache() {
  try {
    await window.caches?.delete(SHEET_CACHE)
  } catch {
    /* no Cache API — nothing cached to purge */
  }
}

/**
 * Click handler for links to the offline sheet.
 *
 * - Online: do nothing — the normal hard navigation proceeds.
 * - Offline with a CONTROLLING worker (the common case): also do nothing. The
 *   navigation is intercepted and served from cache as a real, hydrated page —
 *   strictly better than anything we can synthesize here.
 * - Offline with NO controller (the iOS first-session pathology): navigation
 *   would hit the dead network and show the browser's own error page. Swap in
 *   the cached sheet as a STATIC document instead: scripts stripped (replaying
 *   a streamed Next document's scripts over a live page crashes the renderer),
 *   stylesheets rewritten to cached blob: URLs. Read-only and inert, but the
 *   whole itinerary — times, addresses, notes, policies — is server-rendered
 *   text, all of it legible.
 */
export function handleOfflineSheetClick(event) {
  // ALWAYS take over the click. Letting the anchor's default navigation run
  // out of React's delegated dispatch segfaulted Chromium's renderer in
  // verification (React event commit racing frame teardown); a programmatic
  // navigation from a microtask is the same outcome without the race.
  event.preventDefault()
  ;(async () => {
    const uncontrolled = !navigator.serviceWorker?.controller
    if (!navigator.onLine && uncontrolled) {
      try {
        const cache = await window.caches.open(SHEET_CACHE)
        const res = await cache.match('/sheet', { ignoreVary: true })
        if (res) {
          const html = await staticizeSheet(await res.text())
          document.open()
          document.write(html)
          document.close()
          return
        }
      } catch {
        /* fall through to the navigation */
      }
    }
    window.location.assign('/sheet')
  })()
}

/** Strip every script; point stylesheets at cached blob: copies. */
async function staticizeSheet(html) {
  let out = html.replace(/<script\b[\s\S]*?<\/script>/gi, '')
  const cssUrls = [...new Set([...out.matchAll(/["'](\/_next\/static\/[^"']+?\.css[^"']*?)["']/g)].map((m) => m[1]))]
  await Promise.all(
    cssUrls.map(async (u) => {
      try {
        const hit = await window.caches.match(u, { ignoreVary: true })
        if (!hit) return
        const blobUrl = URL.createObjectURL(await hit.blob())
        out = out.split(`"${u}"`).join(`"${blobUrl}"`).split(`'${u}'`).join(`'${blobUrl}'`)
      } catch {
        /* leave the url — worst case that stylesheet is skipped */
      }
    }),
  )
  return out
}

/**
 * Fetch an attachment's bytes with the same no-worker-required strategy:
 * cache first (SHEET_CACHE keys attachments by pathname), then network.
 * Returns a Blob or null.
 */
export async function readAttachment(url) {
  try {
    const cached = await window.caches.match(url, { ignoreVary: true })
    if (cached && cached.ok) return await cached.blob()
  } catch {
    /* fall through to network */
  }
  try {
    const res = await fetch(url)
    if (res.ok) return await res.blob()
  } catch {
    /* offline and uncached */
  }
  return null
}
