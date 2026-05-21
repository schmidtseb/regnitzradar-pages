/* Regnitzradar service worker — app-shell caching for PWA installability.
   Live weather data, map tiles and routing are never cached (always network). */
const CACHE = 'regnitzradar-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App shell (HTML): network-first so a redeploy is picked up; fall back to cache offline.
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(req)
        .then(res => { caches.open(CACHE).then(c => c.put(req, res.clone())); return res; })
        .catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
    );
    return;
  }

  // Precached static assets (icons, manifest, Leaflet libs): cache-first.
  if (SHELL.some(s => req.url === s || req.url.endsWith(s.replace('./', '/')))) {
    e.respondWith(caches.match(req).then(m => m || fetch(req)));
    return;
  }

  // Everything else (wetterochs data/images, CARTO tiles, OSRM routing): passthrough.
});
