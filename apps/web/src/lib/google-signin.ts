import { APP_NAME } from './brand';
import type { GoogleErrorCode } from '@life-portal/shared-types';
import { API_URL } from './api';

/**
 * Continue with Google (issue #28). The browser keeps a random binding secret and the API only
 * ever sees its SHA-256. The API's answer, after Google, is a one-time code in the URL fragment
 * that only works together with that secret, so a code opened in another browser (a forced
 * sign-in, or a callback that landed in Safari instead of the installed app) does nothing.
 */
export const GOOGLE_BINDING_KEY = 'lp.google.binding';

export interface GoogleStart {
  intent?: 'link';
  /** From `POST /auth/google/link-ticket`, for `intent: 'link'`. */
  ticket?: string;
  /** A path on this app to land on afterwards. */
  returnTo?: string;
}

function base64url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Where to send the browser to begin, after keeping a fresh binding secret. */
export async function googleStartUrl(options: GoogleStart = {}, storage: Storage = window.localStorage): Promise<string> {
  const binding = base64url(crypto.getRandomValues(new Uint8Array(32)));
  storage.setItem(GOOGLE_BINDING_KEY, binding);
  const query = new URLSearchParams({ binding: await sha256Hex(binding) });
  if (options.returnTo) query.set('returnTo', options.returnTo);
  if (options.intent) query.set('intent', options.intent);
  if (options.ticket) query.set('ticket', options.ticket);
  return `${API_URL}/auth/google/start?${query}`;
}

export async function startGoogle(options: GoogleStart = {}): Promise<void> {
  window.location.assign(await googleStartUrl(options));
}

/** The secret this browser kept. It stays until the round trip is finished or abandoned. */
export function googleBinding(storage: Storage = window.localStorage): string | null {
  try {
    return storage.getItem(GOOGLE_BINDING_KEY);
  } catch {
    return null;
  }
}

export function forgetGoogleBinding(storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(GOOGLE_BINDING_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Reads `#code=` or `#error=` from the page the API sent the browser back to. */
export function readGoogleReturn(hash: string): { code: string } | { error: GoogleErrorCode } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('code');
  if (code) return { code };
  const error = params.get('error');
  if (error) return { error: (GOOGLE_ERRORS as Record<string, string>)[error] ? (error as GoogleErrorCode) : 'failed' };
  return null;
}

const GOOGLE_ERRORS: Record<GoogleErrorCode, string> = {
  cancelled: 'Google sign-in was cancelled.',
  expired: 'That sign-in took too long or was already used. Try again.',
  email_unverified: 'Google has not verified the email on that Google account, so it cannot be used here.',
  already_linked_elsewhere: `That Google account is already linked to a different ${APP_NAME} account.`,
  account_has_google: 'This account is already linked to a different Google account. Unlink it first.',
  failed: 'Google sign-in did not work. Try again.',
};

export function googleErrorMessage(code: GoogleErrorCode): string {
  return GOOGLE_ERRORS[code] ?? GOOGLE_ERRORS.failed;
}

/** Only paths on this app. Anything else lands on the dashboard. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}
