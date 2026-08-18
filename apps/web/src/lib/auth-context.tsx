'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@life-portal/shared-types';
import { api, ApiError, tokens } from './api';

interface AuthState {
  user: User | null;
  /** True until the stored token has been checked, so pages do not flash the login screen. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (body: { email: string; password: string; name: string; inviteCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // On mount, a stored token is verified against the server rather than trusted: it may have
  // been revoked by a logout elsewhere or a password change.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!tokens.access && !tokens.refresh) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const me = await api.get<User>('/auth/me');
        if (!cancelled) setUser(me);
      } catch {
        tokens.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api.login(email, password);
      tokens.set(session);
      setUser(session.user);
      router.push('/');
    },
    [router],
  );

  const register = useCallback(
    async (body: { email: string; password: string; name: string; inviteCode?: string }) => {
      const session = await api.register(body);
      tokens.set(session);
      setUser(session.user);
      router.push('/');
    },
    [router],
  );

  const logout = useCallback(async () => {
    // A failed logout still clears locally — the user asked to be signed out, and the
    // refresh token expires on its own.
    await api.post('/auth/logout').catch((error: unknown) => {
      if (!(error instanceof ApiError)) throw error;
    });
    tokens.clear();
    setUser(null);
    router.push('/login');
  }, [router]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
