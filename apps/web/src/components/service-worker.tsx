'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { serviceWorkerUrl } from '../lib/push';

/**
 * Registers the service worker, once, after the page is interactive, and follows the
 * navigation a notification tap asks for.
 *
 * Development registers `/sw.js?mode=push`: push notifications work there, but the worker
 * caches nothing, because a stale cached bundle during a hot reload is a confusing bug to chase.
 */
export function ServiceWorkerRegistration() {
  const router = useRouter();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register(serviceWorkerUrl()).catch(() => {
        // An unavailable service worker must never break the app — it only adds offline support.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    // A tapped notification focuses this window and asks it to open a path (sw.js).
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (
        data?.type === 'navigate' &&
        typeof data.url === 'string' &&
        data.url.startsWith('/') &&
        !data.url.startsWith('//')
      )
        router.push(data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  return null;
}
