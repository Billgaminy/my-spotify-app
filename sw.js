const CACHE_NAME = 'myspotify-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// Εγκατάσταση: αποθηκεύει τα βασικά αρχεία στην cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Ενεργοποίηση: καθαρίζει παλιές caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch: δοκιμάζει πρώτα από cache, αλλιώς από δίκτυο
self.addEventListener('fetch', (event) => {
  // Αγνόησε requests που δεν είναι GET
  if (event.request.method !== 'GET') return;
  
  // Αγνόησε requests σε άλλα domains (π.χ. Tailwind CDN, Google Fonts)
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        // Αποθήκευσε νέα αρχεία στην cache
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});