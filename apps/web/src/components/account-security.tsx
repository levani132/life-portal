'use client';

import type { AuthSessionInfo } from '@life-portal/shared-types';
import { useState } from 'react';
import useSWR from 'swr';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { ErrorNote, Field, Panel, PasswordInput, Spinner } from './ui';

const message = (caught: unknown) =>
  caught instanceof ApiError ? caught.message : 'That did not work. Check your connection and try again.';

/**
 * Change password (issue #27). The current password is required; success keeps this device
 * signed in and signs every other one out, which the API does in the same request.
 */
export function ChangePasswordPanel({ onChanged }: { onChanged?: () => void }) {
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
