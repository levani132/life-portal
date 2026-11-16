import type { AuthSession, AuthTokens } from '@life-portal/shared-types';

/**
 * Browser API client.
 *
 * Two things it handles that a bare `fetch` would not:
 *
 * 1. **Transparent refresh.** A 401 triggers one refresh attempt and one replay of the
 *    original request. Concurrent 401s share a single in-flight refresh (`refreshPromise`),
 *    so a dashboard firing six requests at once does not mint six refresh tokens and
 *    invalidate its own session — the server rotates the refresh token on every use.
 * 2. **Typed errors.** Nest's validation errors arrive as `{ message: string[] }`; this
 *    flattens them into something showable next to a form.
 */

export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3333/api';

/**
 * The API's address for something outside this app: an MCP client, an iOS Shortcut (issue #29).
 * The web app itself may reach the API through its own origin (`/api`, proxied), which means
 * nothing to those clients, so they get `NEXT_PUBLIC_API_PUBLIC_URL`, or an absolute `API_URL`.
 */
export function externalApiUrl(): string {
  const configured = process.env['NEXT_PUBLIC_API_PUBLIC_URL'];
  if (configured) return configured.replace(/\/$/, '');
  if (/^https?:\/\//.test(API_URL)) return API_URL.replace(/\/$/, '');
  return typeof window === 'undefined' ? API_URL : `${window.location.origin}${API_URL}`;
}
const ACCESS_KEY = 'lp.accessToken';
const REFRESH_KEY = 'lp.refreshToken';

/**
 * Issue #29: with the API on this app's own origin (`/api`, proxied to the API host), the refresh
 * token is an `HttpOnly` cookie and the access token lives in memory only, so no script can read
 * either from storage. Storage keeps only `lp.session`: the signed-in account's id, a hint that a
 * session cookie may exist (and whose), never a credential. With an absolute `API_URL` (another
 * site) a cookie could not be first-party, so tokens stay in storage as before.
 */
export const cookieSession = API_URL.startsWith('/');
const SESSION_HINT_KEY = 'lp.session';
/** Sent with every request in cookie mode; the API keeps the refresh token in the cookie. */
const SESSION_HEADERS: Record<string, string> = cookieSession ? { 'x-lp-session': 'cookie' } : {};
let memoryAccess: string | null = null;

/** The account a token was issued to (`sub`), without verifying it. */
export function subjectOf(token: string | null | undefined): string | undefined {
  const payload = token?.split('.')[1];
  if (!payload) return undefined;
  try {
    const sub = (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : undefined;
  } catch {
    return undefined;
  }
}

const storage = {
  get: (key: string) => (typeof window === 'undefined' ? null : window.localStorage.getItem(key)),
  set: (key: string, value: string) => window.localStorage.setItem(key, value),
  remove: (key: string) => window.localStorage.removeItem(key),
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Field-level messages from `class-validator`, when present. */
    readonly details?: string[],
    /** The API's machine-readable `code` (e.g. `PLAN_CHANGED`), when it sent one. */
    readonly code?: string,
    /** The whole error body, for codes that carry more (e.g. `SESSION_CONFLICT`'s `openSessionId`). */
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokens = {
  get access(): string | null {
    return cookieSession ? memoryAccess : storage.get(ACCESS_KEY);
  },
  /**
   * The refresh token readable by this page: in storage outside cookie mode; in cookie mode only
   * a token left from before #29, sent once to move it into the cookie.
   */
  get refresh(): string | null {
    return storage.get(REFRESH_KEY);
  },
  /** Whether this device may have a session, before asking the server. */
  get present(): boolean {
    return Boolean(this.access || this.refresh || (cookieSession && storage.get(SESSION_HINT_KEY)));
  },
  /** The account the session belongs to, as far as this device knows; for spec 034's replay check. */
  get subject(): string | undefined {
    return subjectOf(this.access) ?? (cookieSession ? storage.get(SESSION_HINT_KEY) ?? undefined : subjectOf(this.refresh));
  },
  set(next: { accessToken: string; refreshToken?: string }): void {
    if (cookieSession) {
      memoryAccess = next.accessToken;
      const subject = subjectOf(next.accessToken);
      if (subject) storage.set(SESSION_HINT_KEY, subject);
      // The cookie holds the session now: nothing readable stays behind.
      storage.remove(ACCESS_KEY);
      storage.remove(REFRESH_KEY);
      return;
    }
    storage.set(ACCESS_KEY, next.accessToken);
    if (next.refreshToken) storage.set(REFRESH_KEY, next.refreshToken);
  },
  clear(): void {
    memoryAccess = null;
    storage.remove(ACCESS_KEY);
    storage.remove(REFRESH_KEY);
    storage.remove(SESSION_HINT_KEY);
  },
};

/** Shared across callers so simultaneous 401s cause exactly one refresh. */
let refreshPromise: Promise<'ok' | 'refused' | 'unreachable'> | null = null;

async function parseError(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new ApiError(response.statusText || 'Request failed', response.status);
  }

  const body = payload as { message?: string | string[]; error?: string; code?: unknown };
  const code = typeof body.code === 'string' ? body.code : undefined;
  if (Array.isArray(body.message)) {
    return new ApiError(body.message[0] ?? 'Validation failed', response.status, body.message, code);
  }
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined;
  return new ApiError(body.message ?? body.error ?? 'Request failed', response.status, undefined, code, record);
}

/** Why the last sign-out happened, when the login page should explain it (issue #27). */
export const SIGNED_OUT_REASON_KEY = 'lp.signedOutReason';

/**
 * `refused` means the server said no (the session is over); `unreachable` means it could not be
 * asked. Only `refused` signs the person out: offline (spec 027) a refresh that cannot reach the
 * server must keep the tokens, or opening the app without signal would log you out.
 *
 * Issue #27: the server rotates the refresh token and treats an old one as stolen, so two tabs
 * must not refresh with the same token. A Web Lock makes the tabs take turns, and a tab that gets
 * the lock after another one refreshed just picks up the stored tokens.
 */
async function refreshSession(): Promise<'ok' | 'refused' | 'unreachable'> {
  const sent = cookieSession ? tokens.access : tokens.refresh;
  if (!cookieSession && !sent) return 'refused';
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return refreshWith(sent);
  return locks.request('lp.refresh', () => refreshWith(sent));
}

/**
 * `sent` is what this tab held when it decided to refresh: the refresh token, or in cookie mode
 * the access token in memory. If it changed while waiting for the lock, a refresh already
 * happened and there is nothing to do.
 */
async function refreshWith(sent: string | null): Promise<'ok' | 'refused' | 'unreachable'> {
  const current = cookieSession ? tokens.access : tokens.refresh;
  if (!cookieSession && !current) return 'refused';
  if (current !== sent) return 'ok';

  // Cookie mode sends no token, except one left in storage from before #29, once.
  const bodyToken = cookieSession ? tokens.refresh : sent;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...SESSION_HEADERS },
      body: JSON.stringify(bodyToken ? { refreshToken: bodyToken } : {}),
    });
  } catch {
    return 'unreachable';
  }
  if (response.status >= 500) return 'unreachable';
  if (response.ok) {
    tokens.set((await response.json()) as AuthTokens);
    return 'ok';
  }

  const code = await response
    .json()
    .then((body: { code?: unknown }) => (typeof body.code === 'string' ? body.code : undefined))
    .catch(() => undefined);
  // Another tab refreshed with this token a moment ago (a browser without Web Locks): its new
  // tokens are about to land in storage, or in cookie mode the cookie already moved on.
  if (code === 'REFRESH_SUPERSEDED') {
    if (!cookieSession && sent && (await tokensReplaced(sent))) return 'ok';
    if (cookieSession && bodyToken === null && (await retryWithCookie())) return 'ok';
  }
  if (code === 'LEGACY_SESSION') {
    try {
      window.localStorage.setItem(SIGNED_OUT_REASON_KEY, 'upgrade');
    } catch {
      // The notice is a courtesy; signing out must not depend on it.
    }
  }
  tokens.clear();
  return 'refused';
}

/** Cookie mode: another tab's refresh rotated the cookie under this one; try once with the new one. */
async function retryWithCookie(): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...SESSION_HEADERS },
      body: '{}',
    });
    if (!response.ok) return false;
    tokens.set((await response.json()) as AuthTokens);
    return true;
  } catch {
    return false;
  }
}

async function tokensReplaced(sent: string, waitMs = 2000): Promise<boolean> {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (tokens.refresh && tokens.refresh !== sent) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** No answer from the server at all (offline, DNS, a dropped connection). Never an `ApiError`. */
export class NetworkError extends Error {
  constructor(
    message = 'No connection.',
    /** Spec 031: the browser was offline, so the request never left the device. */
    readonly notSent = false,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Called after every successful write. Lets a cross-cutting concern (profile badges, spec 022)
 * react to the writes it cares about without every call site knowing about it. A listener must
 * not throw and must not await anything the caller waits on.
 */
type WriteListener = (method: string, path: string) => void;
const writeListeners = new Set<WriteListener>();
export function onSuccessfulWrite(listener: WriteListener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skips the Authorization header, for login and register. */
  anonymous?: boolean;
  /** Internal: prevents a refresh loop. */
  isRetry?: boolean;
  /** Extra headers, e.g. `Idempotency-Key` from the offline outbox (spec 027). */
  headers?: Record<string, string>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous, isRetry } = options;

  const headers: Record<string, string> = { ...SESSION_HEADERS, ...options.headers };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!anonymous) {
    const access = tokens.access;
    if (access) headers['Authorization'] = `Bearer ${access}`;
  }

  // Spec 031: with no network at all, say so without trying, so the outbox knows nothing was sent.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetworkError(undefined, true);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }

  if (response.status === 401 && !anonymous && !isRetry) {
    refreshPromise ??= refreshSession().finally(() => {
      refreshPromise = null;
    });
    const refreshed = await refreshPromise;
    if (refreshed === 'ok') {
      return request<T>(path, { ...options, isRetry: true });
    }
    if (refreshed === 'unreachable') throw new NetworkError();
    tokens.clear();
    // Let the auth context redirect; throwing here keeps SWR from caching a bad result.
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (!response.ok) throw await parseError(response);
  if (method !== 'GET') {
    for (const listener of writeListeners) {
      try {
        listener(method, path);
      } catch {
        // A listener never breaks the write that triggered it.
      }
    }
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  login: (email: string, password: string) =>
    request<AuthSession>('/auth/login', { method: 'POST', body: { email, password }, anonymous: true }),

  register: (body: { email: string; password: string; name: string; inviteCode?: string }) =>
    request<AuthSession>('/auth/register', { method: 'POST', body, anonymous: true }),
};
