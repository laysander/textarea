const CACHE_NAME = 'textarea-2026-02-26'
const ASSETS = [
  '/',
  '/qr',
  '/qr.html',
  '/index.css',
  '/index.js',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await Promise.all(
      ASSETS.map(async (asset) => {
        try {
          await cache.add(asset)
        } catch (error) {
          console.warn('[sw] cache add failed:', asset, error)
        }
      })
    )
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName)
          }
        })
      )
    }).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request)
      })
  )
})
