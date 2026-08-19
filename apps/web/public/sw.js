/*
 * Service worker: makes the app installable and survivable on a bad connection.
 *
 * The rule that matters most here is what is **not** cached. This dashboard is one person's
 * finances, debts, weight and food log, and a cache lives on disk long after the tab closes — so
 * every `/api` response goes to the network and nothing else. Offline you get the shell and an
 * honest "no connection" state, never a stale copy of somebody's private numbers.
 *
 * Written by hand rather than generated: a workbox dependency would need justifying in writing
 * (constitution, Governance) and this is forty lines.
 */
const VERSION = 'v1';
const SHELL_CACHE = `life-portal-shell-${VERSION}`;
const ASSET_CACHE = `life-portal-assets-${VERSION}`;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.endsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the owner's data. See the note at the top of this file.
  if (url.pathname.startsWith('/api')) return;

  // Build output is content-hashed and immutable, so cache-first is safe and fast.
  if (url.pathname.startsWith('/_next/static')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else — pages, icons — network first, falling back to whatever was cached, and
  // finally to the shell so a cold launch offline still renders something.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.mode === 'navigate') {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? (await caches.match('/')) ?? Response.error()),
  );
});
