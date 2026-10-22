const CACHE_PREFIX = "personal-tap-";
const UNIVERSITY_ADMISSION_RELEASE = "db4ae4cff3e264503abfee904ad5a5f9913f62723962a312dbe6501af5e078e0";
const CACHE_NAME = `${CACHE_PREFIX}v4.3.1-ai-refresh.1-admission-${UNIVERSITY_ADMISSION_RELEASE.slice(0, 12)}`;
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
  "./apps/volatility/data/local-nasdaq-snapshot.json",
  "./apps/ai-trend/",
  "./apps/ai-trend/index.html",
  // Match the versioned HTML/module graph even while an older cache-first
  // worker controls the page. Bump these URLs with AI client code changes.
  "./apps/ai-trend/styles.css?v=20261021.3",
  "./apps/ai-trend/js/app.js?v=20261021.3",
  "./apps/ai-trend/js/model.js?v=20261021.3",
  "./apps/ai-trend/js/schedule.js?v=20261021.3",
  "./apps/ai-trend/data/latest.json",
  "./apps/ai-trend/data/index.json"
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

  const VOLATILITY_REFRESHABLE_PATHS = [
    "/apps/volatility/data/local-nasdaq-snapshot.json",
    "/apps/volatility/js/weekly-reference.generated.js"
  ];
  if (VOLATILITY_REFRESHABLE_PATHS.some(pathname => url.pathname.endsWith(pathname)) ||
      /\/apps\/ai-trend\/data\//.test(url.pathname)) {
    // A refresh nonce must not make the offline copy unreachable, or create
    // an extra cached edition on every button press.
    const cacheKey = new Request(`${url.origin}${url.pathname}`);
    event.respondWith((async () => {
      try {
        const response = await fetch(new Request(request, { cache: "no-store" }));
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(cacheKey, response.clone());
        }
        return response;
      } catch {
        return caches.match(cacheKey);
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
        if (request.url.includes("/apps/ai-trend/")) {
          return caches.match("./apps/ai-trend/index.html");
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
