/**
 * Issue #29 through the real API and Mongo: the web app's refresh token is an HttpOnly cookie,
 * a cookie refresh is refused from another site, body-mode clients are unchanged, a token kept
 * in browser storage moves into the cookie once, and requests through the web app's own `/api`
 * prove themselves to get the visitor's address.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { startApi, type TestApi } from './harness';

const SECRET = randomBytes(24).toString('hex');
const WEB = 'http://localhost:4200';
let api: TestApi;
beforeAll(async () => {
  api = await startApi({ WEB_PROXY_SECRET: SECRET });
});
afterAll(() => api?.close());

let n = 0;
const ip = () => `10.29.${Math.floor(n / 250)}.${n++ % 250}`;

async function raw(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const response = await fetch(api.url + path, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', 'X-Forwarded-For': ip(), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : undefined) as Record<string, unknown>,
    cookies: response.headers.getSetCookie(),
  };
}

const cookieMode = { 'x-lp-session': 'cookie', origin: WEB };
const valueOf = (setCookie: string) => /^lp_refresh=([^;]*)/.exec(setCookie)?.[1] ?? '';

async function person() {
  const email = `c-${randomUUID().slice(0, 8)}@int.test`;
  const password = `pw-${randomUUID()}`;
  const registered = await raw('/auth/register', { body: { email, password, name: 'Cookie' }, headers: cookieMode });
  expect(registered.status).toBe(201);
  return { email, password, registered };
}

describe('cookie mode', () => {
  it('puts the refresh token in an HttpOnly, Strict cookie scoped to /api/auth, and not in the body', async () => {
    const { registered } = await person();
    expect(registered.body['refreshToken']).toBeUndefined();
    expect(registered.body['accessToken']).toEqual(expect.any(String));
    expect(registered.cookies).toHaveLength(1);
    const [cookie] = registered.cookies;
    expect(cookie).toMatch(/^lp_refresh=[^;]+; Path=\/api\/auth; HttpOnly; SameSite=Strict; Max-Age=2592000/);
    // The tests speak plain http to 127.0.0.1, so Secure is left off; anywhere else it is set.
    expect(cookie).not.toContain('Secure');
  });

  it('refreshes from the cookie and rotates it; the old one is then refused', async () => {
    const { registered } = await person();
    const first = valueOf(registered.cookies[0]);
    const refreshed = await raw('/auth/refresh', { body: {}, headers: { ...cookieMode, cookie: `lp_refresh=${first}` } });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body['refreshToken']).toBeUndefined();
    const second = valueOf(refreshed.cookies[0]);
    expect(second).not.toBe(first);
    expect(second).not.toBe('');

    const replayed = await raw('/auth/refresh', { body: {}, headers: { ...cookieMode, cookie: `lp_refresh=${first}` } });
    expect(replayed.status).toBeGreaterThanOrEqual(400);
    expect(replayed.status).toBeLessThan(500);
  });

  it('refuses a cookie refresh from another site, or without the header, and clears the cookie', async () => {
    const { registered } = await person();
    const cookie = `lp_refresh=${valueOf(registered.cookies[0])}`;
    const foreign = await raw('/auth/refresh', { body: {}, headers: { 'x-lp-session': 'cookie', origin: 'https://evil.example', cookie } });
    expect(foreign.status).toBe(401);
    expect(foreign.cookies[0]).toMatch(/^lp_refresh=; .*Max-Age=0/);
    const noOrigin = await raw('/auth/refresh', { body: {}, headers: { 'x-lp-session': 'cookie', cookie } });
    expect(noOrigin.status).toBe(401);
    const noHeader = await raw('/auth/refresh', { body: {}, headers: { origin: WEB, cookie } });
    expect(noHeader.status).toBe(401);
    // None of those spent the token: the real app can still refresh with it.
    expect((await raw('/auth/refresh', { body: {}, headers: { ...cookieMode, cookie } })).status).toBe(200);
  });

  it('clears the cookie on sign-out', async () => {
    const { registered } = await person();
    const out = await raw('/auth/logout', { headers: { ...cookieMode, authorization: `Bearer ${registered.body['accessToken']}` } });
    expect(out.status).toBe(200);
    expect(out.cookies[0]).toMatch(/^lp_refresh=; .*Max-Age=0/);
  });
});

describe('body mode and the move to cookies', () => {
  it('is unchanged without the header: tokens in the body, no cookie', async () => {
    const email = `b-${randomUUID().slice(0, 8)}@int.test`;
    const registered = await raw('/auth/register', { body: { email, password: `pw-${randomUUID()}`, name: 'Body' } });
    expect(registered.body['refreshToken']).toEqual(expect.any(String));
    expect(registered.cookies).toEqual([]);
  });

  it('moves a refresh token kept in browser storage into the cookie, once', async () => {
    const email = `m-${randomUUID().slice(0, 8)}@int.test`;
    const registered = await raw('/auth/register', { body: { email, password: `pw-${randomUUID()}`, name: 'Moving' } });
    const stored = registered.body['refreshToken'] as string;
    const moved = await raw('/auth/refresh', { body: { refreshToken: stored }, headers: cookieMode });
    expect(moved.status).toBe(200);
    expect(moved.body['refreshToken']).toBeUndefined();
    expect(valueOf(moved.cookies[0])).not.toBe('');
    // The stored one was rotated away.
    expect((await raw('/auth/refresh', { body: { refreshToken: stored } })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('the web app proxy proof', () => {
  const health = (headers: Record<string, string>) => raw('/health', { method: 'GET', headers });

  it('is recognised only with the right secret', async () => {
    expect((await health({ 'x-lp-proxy': SECRET, 'x-real-ip': '203.0.113.9' })).body['proxied']).toBe(true);
    expect((await health({ 'x-lp-proxy': 'nope', 'x-real-ip': '203.0.113.9' })).body['proxied']).toBe(false);
    expect((await health({})).body['proxied']).toBe(false);
    // Which step failed, without any value (issue #29's production diagnosis).
    expect((await health({ 'x-lp-proxy': 'nope', 'x-real-ip': '203.0.113.9' })).body['proxy']).toBe('mismatch');
    expect((await health({ 'x-lp-proxy': SECRET })).body['proxy']).toBe('no-ip');
    expect((await health({})).body['proxy']).toBe('no-header');
  });

  it('gives each visitor their own sign-in limit, by the address Vercel saw', async () => {
    // Fixed caller address, as every request through the proxy has; the visitor varies.
    const via = (visitor: string) => ({ 'X-Forwarded-For': '76.76.21.21', 'x-lp-proxy': SECRET, 'x-real-ip': visitor });
    // A new email each time, so only the per-IP limit (30 in 15 minutes) can apply.
    const attempt = (visitor: string) =>
      fetch(`${api.url}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...via(visitor) },
        body: JSON.stringify({ email: `nobody-${randomUUID().slice(0, 8)}@int.test`, password: 'x'.repeat(12) }),
      });
    let throttled = 0;
    // The window is aligned to the clock, so a run that crosses a quarter hour splits the
    // attempts between two windows: 62 leaves at least 31 in one of them.
    for (let i = 0; i < 62; i++) if ((await attempt('198.51.100.1')).status === 429) throttled++;
    expect(throttled).toBeGreaterThan(0);
    // Another visitor through the same proxy address is not throttled with them.
    expect((await attempt('198.51.100.2')).status).not.toBe(429);
  });
});
