const CACHE_NAME = 'tactical-fire-v1';
const DATA_CACHE_NAME = 'tactical-data-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME && key !== DATA_CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// Cache-First strategy for static assets, Network-First for API requests.
self.addEventListener('fetch', (evt) => {
  if (evt.request.url.includes('api.weather.gov')) {
    evt.respondWith(
      fetch(evt.request)
        .then((response) => {
          const respClone = response.clone();
          caches.open(DATA_CACHE_NAME).then((cache) => {
            cache.put(evt.request, respClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(evt.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return empty graceful failure since NWS APIs send JSON
            return new Response(JSON.stringify({ offline: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
  } else {
    // App Shell: Cache-First
    evt.respondWith(
      caches.match(evt.request).then((response) => {
        return response || fetch(evt.request);
      })
    );
  }
});
