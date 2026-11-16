import type { Request, Response } from 'express';
import { REFRESH_COOKIE, SessionCookies, fromOwnOrigin, readCookie, refreshCookie, wantsCookie } from './session-cookie';

const ORIGINS = ['https://app.example'];
const cookies = new SessionCookies(ORIGINS, 2_592_000);
const req = (headers: Record<string, string>, extra: Partial<Request> = {}) =>
  ({ headers, hostname: 'app.example', secure: true, ...extra }) as unknown as Request;
const res = () => {
  const set: string[] = [];
  return { set, res: { append: (_name: string, value: string) => set.push(value) } as unknown as Response };
};

describe('the refresh cookie (#29)', () => {
  it('is HttpOnly, Strict, scoped to /api/auth, Secure and 30 days', () => {
    expect(refreshCookie('t.k', { secure: true, maxAgeSeconds: 2_592_000 })).toBe(
      'lp_refresh=t.k; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure',
    );
  });

  it('clears with an empty value and no lifetime', () => {
    expect(refreshCookie(null, { secure: true, maxAgeSeconds: 99 })).toBe('lp_refresh=; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=0; Secure');
  });

  it('reads one cookie among others', () => {
    expect(readCookie('a=1; lp_refresh=abc%2Edef; b=2', REFRESH_COOKIE)).toBe('abc.def');
    expect(readCookie('a=1', REFRESH_COOKIE)).toBeUndefined();
    expect(readCookie('lp_refresh=', REFRESH_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, REFRESH_COOKIE)).toBeUndefined();
  });

  it('is asked for with the header and only from a listed origin', () => {
    expect(wantsCookie({ 'x-lp-session': 'cookie' })).toBe(true);
    expect(wantsCookie({})).toBe(false);
    expect(fromOwnOrigin({ origin: 'https://app.example' }, ORIGINS)).toBe(true);
    expect(fromOwnOrigin({ origin: 'https://evil.example' }, ORIGINS)).toBe(false);
    expect(fromOwnOrigin({}, ORIGINS)).toBe(false);
  });
});

describe('SessionCookies', () => {
  const session = { accessToken: 'a', refreshToken: 'r', expiresIn: 900 };

  it('moves the refresh token into the cookie in cookie mode', () => {
    const out = res();
    const body = cookies.deliver(req({ 'x-lp-session': 'cookie' }), out.res, session);
    expect(body).toEqual({ accessToken: 'a', expiresIn: 900 });
    expect(out.set[0]).toMatch(/^lp_refresh=r; /);
  });

  it('leaves body mode exactly as it was', () => {
    const out = res();
    expect(cookies.deliver(req({}), out.res, session)).toEqual(session);
    expect(out.set).toEqual([]);
  });

  it('drops Secure only for plain-http localhost', () => {
    const out = res();
    cookies.deliver(req({ 'x-lp-session': 'cookie' }, { hostname: 'localhost', secure: false }), out.res, session);
    expect(out.set[0]).not.toContain('Secure');
  });

  it('prefers a token in the body (the one-time move from browser storage)', () => {
    expect(cookies.refreshTokenOf(req({}), 'body')).toEqual({ token: 'body', fromCookie: false });
  });

  it('takes the cookie only with the header and an own origin', () => {
    const cookie = { cookie: 'lp_refresh=c' };
    expect(cookies.refreshTokenOf(req({ ...cookie, 'x-lp-session': 'cookie', origin: 'https://app.example' }), undefined)).toEqual({
      token: 'c',
      fromCookie: true,
    });
    expect(() => cookies.refreshTokenOf(req({ ...cookie, origin: 'https://app.example' }), undefined)).toThrow();
    expect(() => cookies.refreshTokenOf(req({ ...cookie, 'x-lp-session': 'cookie', origin: 'https://evil.example' }), undefined)).toThrow();
    expect(() => cookies.refreshTokenOf(req({ 'x-lp-session': 'cookie', origin: 'https://app.example' }), undefined)).toThrow();
  });
});
