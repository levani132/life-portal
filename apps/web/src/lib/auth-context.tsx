'use client';

import { mutate } from 'swr';

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
import { api, ApiError, NetworkError, tokens } from './api';
import { unregisterThisDevice } from './push';
import { forgetUser, rememberedUser, rememberUser } from './offline/account';
import { deleteOfflineData, endOffline, outbox, startOffline } from './offline/runtime';
import { PendingLogout } from '../components/pending-logout';

interface AuthState {
  user: User | null;
  /** True until the stored token has been checked, so pages do not flash the login screen. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (body: { email: string; password: string; name: string; inviteCode?: string }) => Promise<void>;
  /** Signs out. With unsent changes on this device it asks first (spec 027). */
  logout: () => Promise<void>;
  /** Opened from the remembered account because the server could not be reached (spec 027). */
  offlineSession: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineSession, setOfflineSession] = useState(false);
  const [askLogout, setAskLogout] = useState(false);
  const router = useRouter();

  // Spec 027: the signed-in account's offline store. A confirmed sign-in also resumes writes
  // that were paused when the session expired; they never replay under another account.
  useEffect(() => {
    if (!user) {
      void endOffline();
      return;
    }
    void startOffline(user.id).then(() => {
      if (!offlineSession) void outbox.resumeAuth();
    });
  }, [user, offlineSession]);

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
        rememberUser(me);
        if (!cancelled) setUser(me);
      } catch (error) {
        if (error instanceof ApiError) {
          // The server answered: this session is over.
          tokens.clear();
        } else {
          // No answer (offline): open as the account this device last confirmed, if any.
          // The tokens stay; the next request that reaches the server checks them.
          const remembered = rememberedUser();
          if (remembered && !cancelled) {
            setUser(remembered);
            setOfflineSession(true);
          }
        }
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
      rememberUser(session.user);
      await mutate(() => true, undefined, { revalidate: false });
      setOfflineSession(false);
      setUser(session.user);
      router.push('/');
    },
    [router],
  );

  const register = useCallback(
    async (body: { email: string; password: string; name: string; inviteCode?: string }) => {
      const session = await api.register(body);
      tokens.set(session);
      rememberUser(session.user);
      await mutate(() => true, undefined, { revalidate: false });
      setOfflineSession(false);
      setUser(session.user);
      router.push('/');
    },
    [router],
  );

  /** Signs out for real. This account's offline data on this device goes with it. */
  const signOut = useCallback(async () => {
    setAskLogout(false);
    // This device stops receiving the account's notifications before the session ends, so
    // whoever signs in next on it does not get them (bounded at 2s, errors ignored).
    await unregisterThisDevice().catch(() => undefined);
    // A failed logout still clears locally — the user asked to be signed out, and the
    // refresh token expires on its own. That includes no connection at all (spec 027).
    await api.post('/auth/logout').catch((error: unknown) => {
      if (!(error instanceof ApiError) && !(error instanceof NetworkError)) throw error;
    });
    tokens.clear();
    if (user) await deleteOfflineData(user.id);
    forgetUser();
    setOfflineSession(false);
    setUser(null);
    await mutate(() => true, undefined, { revalidate: false });
    router.push('/login');
  }, [router, user]);

  // Spec 027: never silently discard writes that are still on this device.
  const logout = useCallback(async () => {
    if (outbox.count() > 0) {
      setAskLogout(true);
      return;
    }
    await signOut();
  }, [signOut]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, offlineSession }),
    [user, loading, login, register, logout, offlineSession],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {askLogout && <PendingLogout onCancel={() => setAskLogout(false)} onSignOut={() => void signOut()} />}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
