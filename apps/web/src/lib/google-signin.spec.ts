import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import {
  GOOGLE_BINDING_KEY,
  forgetGoogleBinding,
  googleBinding,
  googleErrorMessage,
  googleStartUrl,
  readGoogleReturn,
  safeReturnPath,
} from './google-signin';

/**
 * Issue #28: the browser keeps a binding secret and only its hash leaves the device, so a
 * Google round trip finishes only in the browser that began it.
 */
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
});
beforeEach(() => window.localStorage.clear());

describe('starting', () => {
  it('keeps a fresh secret and sends only its SHA-256', async () => {
    const url = new URL(await googleStartUrl({ returnTo: '/training' }));
    const kept = googleBinding() as string;
    expect(kept).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.pathname).toMatch(/\/auth\/google\/start$/);
    expect(url.searchParams.get('binding')).toBe(createHash('sha256').update(kept).digest('hex'));
    expect(url.toString()).not.toContain(kept);
    expect(url.searchParams.get('returnTo')).toBe('/training');
    expect(url.searchParams.has('intent')).toBe(false);
  });

  it('makes a new secret every time', async () => {
    await googleStartUrl();
    const first = googleBinding();
    await googleStartUrl();
    expect(googleBinding()).not.toBe(first);
  });

  it('carries the link ticket for linking from Settings', async () => {
    const url = new URL(await googleStartUrl({ intent: 'link', ticket: 't1' }));
    expect(url.searchParams.get('intent')).toBe('link');
    expect(url.searchParams.get('ticket')).toBe('t1');
  });

  it('forgets the secret', async () => {
    await googleStartUrl();
    forgetGoogleBinding();
    expect(window.localStorage.getItem(GOOGLE_BINDING_KEY)).toBeNull();
  });
});

describe('coming back', () => {
  it('reads a code or an error from the fragment', () => {
    expect(readGoogleReturn('#code=abc')).toEqual({ code: 'abc' });
    expect(readGoogleReturn('#error=cancelled')).toEqual({ error: 'cancelled' });
    expect(readGoogleReturn('')).toBeNull();
  });

  it('treats an error it does not know as a plain failure', () => {
    expect(readGoogleReturn('#error=<script>')).toEqual({ error: 'failed' });
    expect(googleErrorMessage('failed')).toMatch(/did not work/);
  });

  it('only lands on paths of this app', () => {
    expect(safeReturnPath('/settings/security')).toBe('/settings/security');
    for (const evil of ['https://evil.example', '//evil.example', '/\\evil.example', '', null, undefined]) {
      expect(safeReturnPath(evil)).toBe('/');
    }
  });
});
