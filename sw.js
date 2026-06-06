/* Regnitzradar service worker — app-shell caching for PWA installability.
   Radar data/frames are cached network-first so the last loop is available
   offline; map tiles and routing are never cached (always network). */
const CACHE = 'regnitzradar-v1';
const DATA_CACHE = 'regnitzradar-data-v1';
// One forecast+observation loop is ~70 frames; keep headroom plus the JSON.
const MAX_DATA_ENTRIES = 160;

// DWD radar JSON manifest and frame PNGs (same path on wetterochs or the proxy).
function isRadarData(url) {
  return url.pathname.includes('/opendata-dwd/data/radar/WN/');
}

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))
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

  // Radar data + frame images: network-first, fall back to last cached copy
  // when offline so the most recent loop still renders. Opaque (no-CORS) and
  // CORS responses are both cacheable.
  if (isRadarData(url)) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(DATA_CACHE)
              .then(c => c.put(req, copy))
              .then(() => trimCache(DATA_CACHE, MAX_DATA_ENTRIES));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else (CARTO tiles, OSRM routing): passthrough.
});
