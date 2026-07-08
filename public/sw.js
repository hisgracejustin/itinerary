const CACHE_NAME = 'itinerary-v1'
const PRECACHE_URLS = [
  '/',
  '/icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET' || request.url.startsWith('chrome-extension')) return

  // Network-first for API/supabase calls
  if (request.url.includes('supabase') || request.url.includes('/rest/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          return response
        })
        .catch(async () => {
          const cached = await caches.match(request)
          return cached || new Response('Offline', { status: 503 })
        })
    )
    return
  }

  // Cache-first for static assets, network fallback
  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) return cached

      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          cache.put(request, response.clone())
        }
        return response
      } catch (e) {
        // SPA fallback for navigation requests
        if (request.mode === 'navigate') {
          const fallback = await caches.match('/')
          if (fallback) return fallback
        }
        return new Response('Offline', { status: 503 })
      }
    })()
  )
})
