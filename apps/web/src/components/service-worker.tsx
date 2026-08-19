'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, once, after the page is interactive.
 *
 * Skipped in development: a stale cached bundle during a hot reload is a genuinely confusing bug
 * to chase, and nothing about installability needs testing on localhost.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // An unavailable service worker must never break the app — it only adds offline support.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
