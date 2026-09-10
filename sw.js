const CACHE_NAME = "muc-bars-v53";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/app.js",
  "./js/data.js",
  "./js/geo.js",
  "./js/store.js",
  "./js/filters.js",
  "./js/map.js",
  "./js/firebase.js",
  "./js/image.js",
  "./js/geocode.js",
  "./js/placesearch.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/logo.svg",
  "./icons/account.svg",
  "./icons/plus.svg",
  "./icons/building.svg",
  "./icons/trophy.svg",
  "./icons/map.svg",
  "./vendor/maplibre/maplibre-gl.mjs",
  "./vendor/maplibre/maplibre-gl-shared.mjs",
  "./vendor/maplibre/maplibre-gl-worker.mjs",
  "./vendor/maplibre/maplibre-gl.css",
  "./data/viertel.geojson",
  "./data/ubahn.geojson"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        APP_SHELL.map(url =>
          fetch(url, { cache: "reload" }).then(response => cache.put(url, response))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // Kartenkacheln/Style nicht cachen

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
