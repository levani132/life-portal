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
const ACCESS_KEY = 'lp.accessToken';
const REFRESH_KEY = 'lp.refreshToken';

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
    return typeof window === 'undefined' ? null : window.localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(REFRESH_KEY);
  },
  set(next: { accessToken: string; refreshToken: string }): void {
    window.localStorage.setItem(ACCESS_KEY, next.accessToken);
    window.localStorage.setItem(REFRESH_KEY, next.refreshToken);
  },
  clear(): void {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
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

/**
 * `refused` means the server said no (the session is over); `unreachable` means it could not be
 * asked. Only `refused` signs the person out: offline (spec 027) a refresh that cannot reach the
 * server must keep the tokens, or opening the app without signal would log you out.
 */
async function refreshSession(): Promise<'ok' | 'refused' | 'unreachable'> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return 'refused';

  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return 'unreachable';
  }
  if (response.status >= 500) return 'unreachable';
  if (!response.ok) {
    tokens.clear();
    return 'refused';
  }
  tokens.set((await response.json()) as AuthTokens);
  return 'ok';
}

/** No answer from the server at all (offline, DNS, a dropped connection). Never an `ApiError`. */
export class NetworkError extends Error {
  constructor(message = 'No connection.') {
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

  const headers: Record<string, string> = { ...options.headers };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!anonymous) {
    const access = tokens.access;
    if (access) headers['Authorization'] = `Bearer ${access}`;
  }

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
