/* Minimal service worker — exists so Android treats this as an installable app.
   Deliberately network-first: staff must always see live data, so we never serve
   a stale item list from cache. The cache is only a fallback when offline.

   BUMP `CACHE` **and** the ?v= on the assets in index.html on every release. */
const CACHE = 'verdelago-lf-v8';
const V = '8';
const SHELL = ['./', './index.html', './style.css?v=' + V, './luxe.css?v=' + V,
  './sbapp.js?v=' + V, './config.js?v=' + V, './logo.svg', './logo-cream.svg', './icon-green.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // never touch Supabase (data + photos) — always straight to the network
  if (url.origin !== location.origin || e.request.method !== 'GET') return;

  // The page itself must always be revalidated: it carries the ?v= that points at
  // the current JS/CSS, so serving a cached copy would pin staff to an old build.
  // (fetch by URL, not by Request — a navigate-mode Request cannot be re-inited.)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request.url, { cache: 'no-cache' })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
