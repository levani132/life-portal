/**
 * Issue #29: with the API on this origin (`/api`), no token is readable from storage. The refresh
 * token is an HttpOnly cookie the browser sends by itself; the access token lives in memory.
 */
type Api = typeof import('./api');
type Send = typeof import('./offline/send');
let cookieSession: Api['cookieSession'];
let request: Api['request'];
let tokens: Api['tokens'];
let sendAs: Send['sendAs'];

beforeAll(async () => {
  // The mode is fixed when the module loads, from the build-time API address.
  process.env['NEXT_PUBLIC_API_URL'] = '/api';
  ({ cookieSession, request, tokens } = await import('./api'));
  ({ sendAs } = await import('./offline/send'));
});
afterAll(() => {
  delete process.env['NEXT_PUBLIC_API_URL'];
});

type Reply = { status: number; body: unknown };
const calls: { path: string; init?: RequestInit }[] = [];
function serve(handler: (path: string, init?: RequestInit) => Reply) {
  calls.length = 0;
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(/^\/api/, '');
    calls.push({ path, init });
    const { status, body } = handler(path, init);
    return { ok: status < 300, status, json: async () => body, statusText: '' };
  }) as unknown as typeof fetch;
}
const jwt = (sub: string) => `h.${btoa(JSON.stringify({ sub }))}.s`;
const headerOf = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string>)[name];

beforeEach(() => {
  window.localStorage.clear();
  tokens.clear();
});

it('is on when the API is on this origin', () => {
  expect(cookieSession).toBe(true);
});

it('keeps the access token in memory and only a user id hint in storage', () => {
  tokens.set({ accessToken: jwt('u1') });
  expect(tokens.access).toBe(jwt('u1'));
  expect(Object.keys(window.localStorage)).toEqual(['lp.session']);
  expect(window.localStorage.getItem('lp.session')).toBe('u1');
  expect(tokens.present).toBe(true);
  expect(tokens.subject).toBe('u1');
});

it('after a reload, refreshes from the cookie and replays, sending no token', async () => {
  window.localStorage.setItem('lp.session', 'u1'); // what a reload leaves behind
  serve((path, init) => {
    if (path === '/auth/refresh') return { status: 200, body: { accessToken: jwt('u1'), expiresIn: 900 } };
    return headerOf(init, 'Authorization') === `Bearer ${jwt('u1')}` ? { status: 200, body: { ok: true } } : { status: 401, body: {} };
  });
  await expect(request('/me')).resolves.toEqual({ ok: true });
  const refresh = calls.find((call) => call.path === '/auth/refresh');
  expect(refresh?.init?.body).toBe('{}');
  expect(headerOf(refresh?.init, 'x-lp-session')).toBe('cookie');
  for (const call of calls) expect(headerOf(call.init, 'x-lp-session')).toBe('cookie');
});

it('moves tokens kept before #29 into the cookie once, then forgets them', async () => {
  window.localStorage.setItem('lp.accessToken', 'old-access');
  window.localStorage.setItem('lp.refreshToken', 'old-refresh');
  expect(tokens.present).toBe(true);
  serve((path, init) => {
    if (path === '/auth/refresh') return { status: 200, body: { accessToken: jwt('u1'), expiresIn: 900 } };
    return headerOf(init, 'Authorization') ? { status: 200, body: { ok: true } } : { status: 401, body: {} };
  });
  await expect(request('/me')).resolves.toEqual({ ok: true });
  expect(calls.find((call) => call.path === '/auth/refresh')?.init?.body).toBe(JSON.stringify({ refreshToken: 'old-refresh' }));
  expect(window.localStorage.getItem('lp.refreshToken')).toBeNull();
  expect(window.localStorage.getItem('lp.accessToken')).toBeNull();
});

it('signs out completely when the cookie is refused', async () => {
  window.localStorage.setItem('lp.session', 'u1');
  serve(() => ({ status: 401, body: {} }));
  await expect(request('/me')).rejects.toThrow(/sign in again/i);
  expect(tokens.present).toBe(false);
});

it('never replays a write for another account after a reload (spec 034)', async () => {
  window.localStorage.setItem('lp.session', 'u2');
  serve(() => ({ status: 200, body: {} }));
  const send = sendAs('u1');
  await expect(
    send({ id: 'w1', kind: 'request', method: 'POST', path: '/x', body: {}, createdAt: Date.now() } as never, async () => undefined),
  ).rejects.toThrow(/another account/);
  expect(calls).toHaveLength(0);
});
