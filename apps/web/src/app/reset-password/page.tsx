'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, request } from '../../lib/api';
import { ErrorNote, Field, PasswordInput } from '../../components/ui';

/** Reads `#token=` and removes it from the address bar, so it is not left in history. */
function takeToken(): string {
  const match = /(?:^|[#&])token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  return match?.[1] ?? '';
}

/**
 * Chooses a new password from an emailed link (issue #27). The token travels in the fragment,
 * which browsers never send to a server, so it does not end up in logs or a Referer header.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const found = takeToken();
    setToken(found);
    if (!found) {
      setValid(false);
      return;
    }
    request<{ valid: boolean }>('/auth/reset-password/check', { method: 'POST', body: { token: found }, anonymous: true })
      .then((answer) => setValid(answer.valid))
      .catch((caught: unknown) => {
        setValid(true); // Let the reset itself say what is wrong.
        if (caught instanceof ApiError) setError(caught.message);
      });
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await request('/auth/reset-password', { method: 'POST', body: { token, password }, anonymous: true });
      router.replace('/login?reset=done');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'RESET_INVALID') setValid(false);
      setError(caught instanceof ApiError ? caught.message : 'Could not reset the password. Check your connection.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">Choose a new password</h1>
        <p className="mb-6 text-sm text-ink-muted">This signs you out everywhere. Then sign in with the new password.</p>

        {valid === false ? (
          <div role="alert" className="card space-y-3 p-5 text-sm">
            <p>This link has expired or was already used.</p>
            <Link href="/forgot-password" className="btn-primary block w-full text-center">
              Request a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="card space-y-4 p-5">
            <Field label="New password" hint="At least 10 characters, and not a common password.">
              <PasswordInput
                autoComplete="new-password"
                required
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="Repeat it">
              <PasswordInput
                autoComplete="new-password"
                required
                minLength={10}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </Field>
            {error && <ErrorNote message={error} />}
            <button type="submit" className="btn-primary w-full" disabled={pending || valid === null}>
              {pending ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
