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

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3333/api';
const ACCESS_KEY = 'lp.accessToken';
const REFRESH_KEY = 'lp.refreshToken';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Field-level messages from `class-validator`, when present. */
    readonly details?: string[],
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
let refreshPromise: Promise<boolean> | null = null;

async function parseError(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new ApiError(response.statusText || 'Request failed', response.status);
  }

  const body = payload as { message?: string | string[]; error?: string };
  if (Array.isArray(body.message)) {
    return new ApiError(body.message[0] ?? 'Validation failed', response.status, body.message);
  }
  return new ApiError(body.message ?? body.error ?? 'Request failed', response.status);
}

async function refreshSession(): Promise<boolean> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      tokens.clear();
      return false;
    }
    tokens.set((await response.json()) as AuthTokens);
    return true;
  } catch {
    return false;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skips the Authorization header, for login and register. */
  anonymous?: boolean;
  /** Internal: prevents a refresh loop. */
  isRetry?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous, isRetry } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!anonymous) {
    const access = tokens.access;
    if (access) headers['Authorization'] = `Bearer ${access}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && !anonymous && !isRetry) {
    refreshPromise ??= refreshSession().finally(() => {
      refreshPromise = null;
    });
    if (await refreshPromise) {
      return request<T>(path, { ...options, isRetry: true });
    }
    tokens.clear();
    // Let the auth context redirect; throwing here keeps SWR from caching a bad result.
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (!response.ok) throw await parseError(response);
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
