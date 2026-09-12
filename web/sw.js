const CACHE_NAME = 'kully-shell-v1';
const SHELL_FILES = [
  '/',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only ever cache same-origin app-shell GETs — everything else (chat,
  // auth, connect/disconnect, history, skills, push, the EC2 domain) must
  // always hit the network live, never served stale from cache.
  const isShellRequest = event.request.method === 'GET' && url.origin === self.location.origin
    && SHELL_FILES.includes(url.pathname);

  if (!isShellRequest) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => cached || caches.match('/'));
      return cached || network;
    }),
  );
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Kully';
  const body = data.body || 'Your server is ready.';
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/icon-192.png' }));
});
