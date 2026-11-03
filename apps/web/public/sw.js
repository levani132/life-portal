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
 *
 * Push notifications (specs/012-web-push-notifications): every `push` shows a notification —
 * iOS revokes a subscription that receives pushes showing nothing, so whether to notify is
 * always decided on the server, never here. The payload is already-written lock-screen text;
 * this file fetches nothing and caches nothing for it.
 *
 * Registered as `/sw.js?mode=push` in development: push works, caching is off, so a hot reload
 * never serves a stale bundle.
 */
const VERSION = 'v2';
const PUSH_ONLY = new URL(self.location.href).searchParams.get('mode') === 'push';
const SHELL_CACHE = `life-portal-shell-${VERSION}`;
const ASSET_CACHE = `life-portal-assets-${VERSION}`;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  if (PUSH_ONLY) {
    event.waitUntil(self.skipWaiting());
    return;
  }
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
  if (PUSH_ONLY) return;
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

/** A path inside this app, or null. Anything else in a payload is ignored. */
function appPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : null;
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Still show something: a push that displays nothing gets the subscription revoked.
  }
  const tag = typeof payload.tag === 'string' ? payload.tag : undefined;
  const badge = Number.isInteger(payload.badge) ? payload.badge : undefined;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(
        typeof payload.title === 'string' ? payload.title : 'Life Portal',
        {
          body: typeof payload.body === 'string' ? payload.body : 'You have new activity',
          tag,
          // A newer comment on a post, or message in a conversation, replaces the older
          // notification but still alerts.
          renotify: !!tag && (tag.startsWith('postComment') || tag.startsWith('message:')),
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          data: { url: appPath(payload.url) ?? '/activity' },
        },
      ),
      badge !== undefined && 'setAppBadge' in self.navigator
        ? self.navigator.setAppBadge(badge).catch(() => undefined)
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = appPath(event.notification.data && event.notification.data.url) ?? '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        // Navigate inside the running app rather than reloading it.
        await open.focus();
        open.postMessage({ type: 'navigate', url });
        return;
      }
      // Inside the manifest scope this opens the installed app, not a browser tab.
      await self.clients.openWindow(url);
    })(),
  );
});
