const CACHE_PREFIX = "personal-tap-";
const CACHE_NAME = `${CACHE_PREFIX}v3.6.1-volatility-recent-reference.1`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./hub.css?v=2.9.0-three-column-grid.1",
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
  "./apps/mensa/js/analytics-model.js",
  "./apps/mensa/js/app.js",
  "./apps/mensa/js/bank-loader.js",
  "./apps/mensa/js/daily-queue-engine.js",
  "./apps/mensa/js/indexeddb-repository.js",
  "./apps/mensa/js/mastery-engine.js",
  "./apps/mensa/js/mode-policy.js",
  "./apps/mensa/js/random.js",
  "./apps/mensa/js/session-engine.js",
  "./apps/mensa/js/stats-model.js",
  "./apps/mensa/js/training-store.js",
  "./apps/mensa/data/question-bank.json",
  "./apps/mensa/icons/icon-192.png",
  "./apps/volatility/",
  "./apps/volatility/index.html",
  "./apps/volatility/styles.css",
  "./apps/volatility/js/app.js",
  "./apps/volatility/js/calculator.js",
  "./apps/volatility/js/weekly-reference.generated.js",
  "./apps/volatility/js/market-provider.js",
  "./apps/volatility/js/local-market-provider.js",
  "./apps/volatility/js/request-guard.js",
  "./apps/volatility/js/snapshot-policy.js",
  "./apps/volatility/data/local-nasdaq-snapshot.json"
];

self.addEventListener("install", event => {
  // A new cache name alone does not bypass the browser HTTP cache. GitHub
  // Pages can keep old JS/CSS responses for several minutes, which could
  // otherwise seed a brand-new CacheStorage with a mixed app version.
  const freshCoreRequests = CORE_ASSETS.map(asset => new Request(asset, { cache: "reload" }));
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(freshCoreRequests))
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

  // Never cache a present or future same-origin market-data API response.
  // A local bridge may later serve /api/* below this scope; it must remain
  // network-only so a stale quote cannot be replayed by the PWA cache.
  if (/\/api(?:\/|$)/.test(url.pathname)) return;

  if (url.pathname.endsWith("/apps/volatility/data/local-nasdaq-snapshot.json")) {
    event.respondWith((async () => {
      try {
        const response = await fetch(new Request(request, { cache: "no-store" }));
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return caches.match(request);
      }
    })());
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

        if (request.url.includes("/apps/mensa/")) {
          return caches.match("./apps/mensa/index.html");
        }
        if (request.url.includes("/apps/volatility/")) {
          return caches.match("./apps/volatility/index.html");
        }
        return caches.match("./index.html");
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response?.status === 200 && response.type !== "opaque") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
