import { ApiError, request, SIGNED_OUT_REASON_KEY, tokens } from './api';

/**
 * Issue #27: the server rotates refresh tokens and treats a reused one as stolen. The client
 * must not sign out over a race with another tab, and must say why when sessions were rebuilt.
 */
type Reply = { status: number; body: unknown };

function serve(handler: (path: string, init?: RequestInit) => Reply) {
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const { status, body } = handler(String(url).replace(/^.*\/api/, ''), init);
    return { ok: status < 300, status, json: async () => body, statusText: '' };
  }) as unknown as typeof fetch;
}

describe('refreshing a session', () => {
  beforeEach(() => {
    window.localStorage.clear();
    tokens.set({ accessToken: 'a1', refreshToken: 'r1' });
  });

  it('rotates and replays the request', async () => {
    serve((path, init) => {
      if (path === '/auth/refresh') return { status: 200, body: { accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 } };
      const auth = (init?.headers as Record<string, string>)['Authorization'];
      return auth === 'Bearer a2' ? { status: 200, body: { ok: true } } : { status: 401, body: {} };
    });
    await expect(request('/me')).resolves.toEqual({ ok: true });
    expect(tokens.refresh).toBe('r2');
  });

  it('picks up the tokens another tab stored instead of signing out on a race', async () => {
    serve((path, init) => {
      if (path === '/auth/refresh') {
        // The other tab wins and stores its new pair while this one is refused.
        setTimeout(() => tokens.set({ accessToken: 'a9', refreshToken: 'r9' }), 50);
        return { status: 409, body: { code: 'REFRESH_SUPERSEDED' } };
      }
      const auth = (init?.headers as Record<string, string>)['Authorization'];
      return auth === 'Bearer a9' ? { status: 200, body: { ok: true } } : { status: 401, body: {} };
    });
    await expect(request('/me')).resolves.toEqual({ ok: true });
    expect(tokens.refresh).toBe('r9');
  });

  it('signs out with a reason when the session predates #27', async () => {
    serve((path) =>
      path === '/auth/refresh' ? { status: 401, body: { code: 'LEGACY_SESSION' } } : { status: 401, body: {} },
    );
    await expect(request('/me')).rejects.toBeInstanceOf(ApiError);
    expect(tokens.refresh).toBeNull();
    expect(window.localStorage.getItem(SIGNED_OUT_REASON_KEY)).toBe('upgrade');
  });

  it('signs out without a reason when the token was reused', async () => {
    serve((path) =>
      path === '/auth/refresh' ? { status: 401, body: { code: 'REFRESH_REUSED' } } : { status: 401, body: {} },
    );
    await expect(request('/me')).rejects.toBeInstanceOf(ApiError);
    expect(tokens.refresh).toBeNull();
    expect(window.localStorage.getItem(SIGNED_OUT_REASON_KEY)).toBeNull();
  });
});
