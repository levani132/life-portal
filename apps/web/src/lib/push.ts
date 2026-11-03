'use client';

import type { NotificationsConfig } from '@life-portal/shared-types';
import { api } from './api';
import { isIOSDevice } from './ios-device';

/**
 * Browser side of push notifications (specs/012-web-push-notifications).
 *
 * The one rule that matters: `Notification.requestPermission()` is called only from
 * `enablePush()`, and `enablePush()` only from a click handler. iOS refuses a prompt that is not
 * a direct response to a tap, and a refused prompt cannot be asked again from the page.
 */

const DEVICE_KEY = 'lp.pushDeviceId';

export type PushSupport =
  /** Can receive pushes here. */
  | 'ready'
  /** iPhone/iPad in a Safari tab: only the Home Screen app can receive pushes. */
  | 'ios-tab'
  /** This browser has no Web Push at all. */
  | 'unsupported';

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  const hasPush =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIOSDevice(navigator) && !isStandalone()) return 'ios-tab';
  return hasPush ? 'ready' : 'unsupported';
}

export function permission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

/** The development build registers a push-only worker; see apps/web/public/sw.js. */
export function serviceWorkerUrl(): string {
  return process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?mode=push';
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) await navigator.serviceWorker.register(serviceWorkerUrl());
  return navigator.serviceWorker.ready;
}

/** A short readable name for the device list, e.g. "iPhone" or "Mac · Chrome". */
export function deviceLabel(userAgent: string): string {
  const device = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'Mac'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : 'This device';
  if (device === 'iPhone' || device === 'iPad') return device;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : '';
  return browser ? `${device} · ${browser}` : device;
}

function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function register(subscription: PushSubscription, enable: boolean) {
  const json = subscription.toJSON();
  const { id } = await api.post<{ id: string }>('/notifications/devices', {
    subscription: { endpoint: json.endpoint, keys: json.keys },
    label: deviceLabel(navigator.userAgent),
    enable,
  });
  try {
    window.localStorage.setItem(DEVICE_KEY, id);
  } catch {
    // Only used to mark "This device" in Settings.
  }
}

export function thisDeviceId(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

/**
 * Turns notifications on for this device. MUST be called from a click handler. Resolves to the
 * resulting permission so the caller can explain a refusal.
 */
export async function enablePush(): Promise<NotificationPermission> {
  // Asked first, synchronously inside the tap, before anything else can break the gesture.
  const result = await Notification.requestPermission();
  if (result !== 'granted') return result;
  const config = await api.get<NotificationsConfig>('/notifications/config');
  if (!config.available || !config.publicKey) throw new Error('Notifications are not available.');
  const reg = await registration();
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(config.publicKey),
    }));
  await register(subscription, true);
  return result;
}

/**
 * On every start with permission granted: re-sends the current subscription. Safari does not
 * reliably fire `pushsubscriptionchange`, and a key rotation invalidates old subscriptions, so
 * this keeps the server's copy current. It never turns notifications on by itself.
 */
export async function resyncSubscription(publicKey: string): Promise<void> {
  if (pushSupport() !== 'ready' || permission() !== 'granted') return;
  const reg = await registration();
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey),
    });
  }
  await register(subscription, false);
}

/** Sign-out: forget this device on the server first, then locally. Best-effort, bounded. */
export async function unregisterThisDevice(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const work = (async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    await api
      .post('/notifications/devices/unregister', { endpoint: subscription.endpoint })
      .catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  })();
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 2000))]);
  try {
    window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Nothing to clean.
  }
}

/** Sets or clears the app icon badge where supported (installed apps on iOS 16.4+, Chromium). */
export function setBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (count > 0) void nav.setAppBadge?.(count).catch(() => undefined);
  else void nav.clearAppBadge?.().catch(() => undefined);
}
