/* Service Worker — My Spotify (λειτουργεί και χωρίς internet) */
const CACHE_NAME = 'myspotify-v2';   // άλλαξε τον αριθμό όταν θέλεις να "σπάσεις" την παλιά cache

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// Εγκατάσταση: αποθηκεύει τα βασικά αρχεία (αν κάποιο λείπει, δεν χαλάει η εγκατάσταση)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

// Ενεργοποίηση: καθαρίζει παλιές caches (π.χ. myspotify-v1)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first με timeout 3": με internet παίρνεις πάντα τη νέα έκδοση των αρχείων,
// χωρίς internet (ή με πολύ αργό) σερβίρεται η αποθηκευμένη.
function networkFirst(request, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = () =>
      caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'));

    const timer = setTimeout(() => {
      fromCache().then((hit) => {
        if (hit && !settled) { settled = true; resolve(hit); }
      });
    }, timeoutMs);

    fetch(request).then((response) => {
      clearTimeout(timer);
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      if (!settled) { settled = true; resolve(response); }
    }).catch(() => {
      clearTimeout(timer);
      if (settled) return;
      fromCache().then((hit) => { settled = true; resolve(hit || Response.error()); });
    });
  });
}

// Γραμματοσειρές Google: από cache αμέσως, ενημέρωση στο παρασκήνιο
function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(request).then((hit) => {
      const network = fetch(request).then((response) => {
        if (response && (response.status === 200 || response.type === 'opaque')) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(() => hit);
      return hit || network;
    })
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (request.headers.has('range')) return;

  if (url.origin === location.origin) {
    event.respondWith(networkFirst(request, 3000));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
});
