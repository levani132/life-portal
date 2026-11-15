'use client';

import type { AuthCapabilities, AuthSessionInfo, SignInMethods, User } from '@life-portal/shared-types';
import { useState } from 'react';
import useSWR from 'swr';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { authCapabilities } from '../lib/auth-capabilities';
import { startGoogle } from '../lib/google-signin';
import { ErrorNote, Field, Panel, PasswordInput, Spinner } from './ui';
import { GoogleMark } from './google-button';

const message = (caught: unknown) =>
  caught instanceof ApiError ? caught.message : 'That did not work. Check your connection and try again.';

/**
 * Change password (issue #27). The current password is required; success keeps this device
 * signed in and signs every other one out, which the API does in the same request.
 */
export function ChangePasswordPanel({ onChanged }: { onChanged?: () => void }) {
  const methods = useSignInMethods();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setDone(false);
    if (next !== repeat) {
      setError("The two new passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
      onChanged?.();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }

  // Issue #28: an account made with Google has no password to change.
  if (methods.data && !methods.data.password) {
    return (
      <Panel title="Password" description="This account signs in with Google.">
        <p className="text-sm text-ink-muted">
          It has no password yet. To add one, sign out and use “Forgot password?” on the sign-in page with{' '}
          {methods.data.google ? <span className="break-all text-ink">{methods.data.google.email}</span> : 'your email'}.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Change password" description="Your other devices are signed out when you change it.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Current password">
          <PasswordInput autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 10 characters, and not a common password.">
          <PasswordInput autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Repeat the new password">
          <PasswordInput autoComplete="new-password" required minLength={10} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </Field>
        {error && <ErrorNote message={error} />}
        {done && (
          <p role="status" className="text-sm text-emerald-400">
            Password changed. Your other devices were signed out.
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </Panel>
  );
}

export function useSignInMethods() {
  return useSWR<SignInMethods>('/auth/methods', (path: string) => api.get<SignInMethods>(path), { revalidateOnFocus: false });
}

/**
 * Google as a way to sign in (issue #28). Linking goes through Google with a short ticket from
 * this signed-in session; unlinking is refused while Google is the only way in.
 */
export function GooglePanel() {
  const methods = useSignInMethods();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const data = methods.data;
  if (data && !data.googleAvailable && !data.google) return null;

  async function link() {
    setPending(true);
    setError(null);
    try {
      const { ticket } = await api.post<{ ticket: string }>('/auth/google/link-ticket');
      await startGoogle({ intent: 'link', ticket, returnTo: '/settings/security' });
    } catch (caught) {
      setError(message(caught));
      setPending(false);
    }
  }

  async function unlink() {
    setPending(true);
    setError(null);
    try {
      await methods.mutate(await api.delete<SignInMethods>('/auth/google'), { revalidate: false });
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === 'LAST_SIGN_IN_METHOD' ? 'Add a password before unlinking Google, or you could not sign in.' : message(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel title="Google" description="Sign in with your Google account instead of typing a password.">
      {methods.error ? (
        <ErrorNote message={message(methods.error)} />
      ) : !data ? (
        <Spinner />
      ) : data.google ? (
        <div className="space-y-3">
          <p className="text-sm">
            Linked to <span className="break-all font-medium">{data.google.email}</span>
            <span className="block text-xs text-ink-faint">since {when(data.google.linkedAt)}</span>
          </p>
          {data.password ? (
            <button type="button" className="btn-danger" disabled={pending} onClick={() => void unlink()}>
              {pending ? 'Unlinking…' : 'Unlink Google'}
            </button>
          ) : (
            <p className="text-xs text-ink-faint">Google is how you sign in, so it can’t be unlinked until the account has a password.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">Not linked. You’ll choose the Google account on Google’s page.</p>
          <div className="max-w-xs">
            <button type="button" className="btn-ghost w-full gap-2 text-ink" disabled={pending} onClick={() => void link()}>
              <GoogleMark />
              {pending ? 'Opening Google…' : 'Link Google account'}
            </button>
          </div>
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </Panel>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The devices signed in to this account (issue #27): sign out one, all the others, or everywhere.
 * "Everywhere" ends the others on the server first, then signs this device out the usual way, so
 * writes still waiting on this device get the usual question before they are discarded.
 */
export function DevicesPanel() {
  const { logout } = useAuth();
  const sessions = useSWR<AuthSessionInfo[]>('/auth/sessions', (path: string) => api.get<AuthSessionInfo[]>(path), {
    revalidateOnFocus: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await sessions.mutate();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(null);
    }
  }

  const rows = sessions.data ?? [];
  const others = rows.filter((row) => !row.current);

  return (
    <Panel title="Signed-in devices" description="Sign out a device you don't recognise or no longer use.">
      {sessions.error ? (
        <ErrorNote message={message(sessions.error)} />
      ) : !sessions.data ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {row.device}
                  {row.current && <span className="ml-2 text-xs font-normal text-accent">This device</span>}
                </p>
                <p className="text-xs text-ink-faint">
                  Active {when(row.lastUsedAt)} · signed in {when(row.createdAt)}
                </p>
              </div>
              {!row.current && (
                <button
                  type="button"
                  className="btn shrink-0"
                  disabled={busy !== null}
                  aria-label={`Sign out ${row.device}, active ${when(row.lastUsedAt)}`}
                  onClick={() => void act(row.id, () => api.delete(`/auth/sessions/${row.id}`))}
                >
                  {busy === row.id ? 'Signing out…' : 'Sign out'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorNote message={error} />}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={busy !== null || others.length === 0}
          onClick={() => void act('others', () => api.post('/auth/sessions/revoke-others'))}
        >
          {busy === 'others' ? 'Signing out…' : 'Sign out other devices'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() =>
            void act('all', async () => {
              await api.post('/auth/sessions/revoke-others');
              await logout();
            })
          }
        >
          Sign out everywhere
        </button>
      </div>
    </Panel>
  );
}

/**
 * The account's email and whether it is confirmed (issue #27). Confirming never gates anything
 * today; it is what linking another sign-in method will require. Offers a link only when this
 * server can send email.
 */
export function EmailPanel() {
  const me = useSWR<User>('/auth/me', (path: string) => api.get<User>(path), { revalidateOnFocus: false });
  const caps = useSWR<AuthCapabilities>('auth:capabilities', () => authCapabilities(), { revalidateOnFocus: false });
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send() {
    setPending(true);
    setError(null);
    try {
      const answer = await api.post<{ sent: boolean; alreadyVerified: boolean }>('/auth/verify-email/send');
      if (answer.alreadyVerified) await me.mutate();
      setNote(answer.alreadyVerified ? 'Your email is already confirmed.' : `We sent a link to ${me.data?.email}. It expires in 48 hours.`);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel title="Email" description="Where password-reset links go.">
      {!me.data ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 break-all">{me.data.email}</span>
            {me.data.emailVerifiedAt ? (
              <span className="text-xs text-emerald-400">Confirmed</span>
            ) : (
              <span className="text-xs text-ink-faint">Not confirmed yet</span>
            )}
          </p>
          {!me.data.emailVerifiedAt && caps.data?.emailVerification && (
            <button type="button" className="btn" disabled={pending} onClick={() => void send()}>
              {pending ? 'Sending…' : 'Send confirmation link'}
            </button>
          )}
          {note && (
            <p role="status" className="text-sm">
              {note}
            </p>
          )}
          {error && <ErrorNote message={error} />}
        </div>
      )}
    </Panel>
  );
}
