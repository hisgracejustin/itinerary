/**
 * Click handler for links to the offline sheet. Online it does nothing and the
 * normal hard navigation proceeds. Offline it takes over: iOS home-screen apps
 * have refused to route first-launch navigations through a fresh service worker
 * (native "This page couldn't load" instead of our fallback), but the Cache API
 * itself is readable from any page — so read the cached /sheet document
 * directly and swap it into this one. preventDefault must happen synchronously,
 * so the cache read runs behind it and falls back to a real navigation (worker
 * fallback, or the browser's own error) only if nothing usable is cached.
 */
export function handleOfflineSheetClick(event) {
  if (typeof navigator === 'undefined' || navigator.onLine) return
  event.preventDefault()
  ;(async () => {
    try {
      const cache = await window.caches.open('itinerary-sheet-v1')
      const res = await cache.match('/sheet', { ignoreVary: true })
      if (res) {
        const html = await res.text()
        document.open()
        document.write(html)
        document.close()
        return
      }
    } catch {
      /* fall through to the navigation */
    }
    window.location.href = '/sheet'
  })()
}
