const CACHE_NAME = 'sim8085-cache-v2';
const STATIC_ASSETS = [
  './',
  './manifest.json',
  './favicon.svg',
  './favicon.ico',
  './sim8085.js',
  './sim8085.wasm'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Network-first for HTML so deploys are picked up immediately
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./'))
    );
    return;
  }
  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
