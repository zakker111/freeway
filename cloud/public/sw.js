// Offline shell for the cloud edition.
//
// The page is one self-contained HTML file, so an installed app can still open
// offline. The shell is network-first: a deployment must replace a broken page
// on the next load instead of serving an old cached copy forever. API calls are
// never cached.
const CACHE = 'freeway-shell-v5';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never serve API data or the worker itself from cache.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/sw.js'
  ) {
    return;
  }

  // A navigable page must come from the network first. This is what lets a
  // fixed deployment replace a cached page that still has an old bug. Only the
  // app shell itself is stored as '/': the standalone viewer is also a
  // navigation and must never overwrite the shell offline copy.
  const shell = url.pathname === '/' || url.pathname === '/index.html';
  if (request.mode === 'navigate' || shell) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await fetch(request);
          if (fresh.ok && shell) await cache.put('/', fresh.clone());
          return fresh;
        } catch {
          return shell ? (await cache.match('/')) || Response.error() : Response.error();
        }
      })(),
    );
    return;
  }

  // Static files can stay cache-first with a background refresh: they are small
  // and an offline shell still needs its icons and manifest.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })(),
  );
});
