const CACHE_PREFIX = "personal-tap-";
const CACHE_NAME = `${CACHE_PREFIX}v2.2.0-mastery.1`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./hub.css",
  "./apps.js",
  "./hub.js",
  "./pwa-update.css",
  "./pwa-update.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./apps/mensa/",
  "./apps/mensa/index.html",
  "./apps/mensa/styles.css",
  "./apps/mensa/js/app.js",
  "./apps/mensa/js/bank-loader.js",
  "./apps/mensa/js/indexeddb-repository.js",
  "./apps/mensa/js/mastery-engine.js",
  "./apps/mensa/js/random.js",
  "./apps/mensa/js/session-engine.js",
  "./apps/mensa/js/stats-model.js",
  "./apps/mensa/js/training-store.js",
  "./apps/mensa/data/question-bank.json",
  "./apps/mensa/icons/icon-192.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )),
      self.clients.claim()
    ])
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (url.origin !== scopeUrl.origin ||
      !url.pathname.startsWith(scopeUrl.pathname)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;

        return request.url.includes("/apps/mensa/")
          ? caches.match("./apps/mensa/index.html")
          : caches.match("./index.html");
      }
    })());
    return;
  }

  const network = fetch(request).then(async response => {
    if (response?.status === 200 && response.type !== "opaque") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  });

  event.waitUntil(network.then(() => undefined).catch(() => undefined));
  event.respondWith(
    caches.match(request).then(cached => cached || network)
  );
});
