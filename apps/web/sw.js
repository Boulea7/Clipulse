const CACHE_NAME = 'clipulse-shell-v3'
const SHELL_ASSETS = [
  './offline.html',
  './static/styles.css',
  './static/app.js',
  './static/icon.svg',
]
const NETWORK_ONLY_PREFIXES = [
  '/api/v1/',
  '/dashboard-login',
  '/dashboard-logout',
  '/contracts/',
  '/docs',
  '/redoc',
  '/openapi.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(fetch(event.request))
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./offline.html')),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  )
})
