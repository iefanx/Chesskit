const CACHE_NAME = 'chesskit-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/play',
  '/analysis',
  '/database',
  '/site.webmanifest',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache and caching basic assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  // Only handle GET requests and skip chrome-extension/dev requests
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const urlPath = new URL(event.request.url).pathname;

  // Cache-first strategy for static assets (pieces, sounds, icons, fonts)
  if (
    urlPath.startsWith('/piece/') ||
    urlPath.startsWith('/sounds/') ||
    urlPath.startsWith('/icons/') ||
    urlPath.includes('.png') ||
    urlPath.includes('.svg') ||
    urlPath.includes('.ico') ||
    urlPath.includes('.mp3') ||
    event.request.url.includes('fonts.gstatic.com') ||
    event.request.url.includes('fonts.googleapis.com')
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cacheCopy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cacheCopy);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Network-first strategy for pages and JS files (to guarantee latest code)
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Cache the updated page response for offline fallback
        if (networkResponse && networkResponse.status === 200) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cacheCopy);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline fallback: serve from cache
        return caches.match(event.request);
      })
  );
});
