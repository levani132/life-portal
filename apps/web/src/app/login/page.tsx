'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, SIGNED_OUT_REASON_KEY } from '../../lib/api';
import { authCapabilities } from '../../lib/auth-capabilities';
import { useAuth } from '../../lib/auth-context';
import { ErrorNote, Field, Input } from '../../components/ui';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [upgraded, setUpgraded] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [canReset, setCanReset] = useState(false);

  useEffect(() => {
    setResetDone(new URLSearchParams(window.location.search).get('reset') === 'done');
    void authCapabilities().then((caps) => setCanReset(caps.passwordReset));
  }, []);

  // Issue #27: everyone was signed out once when sign-in sessions were rebuilt. Say why.
  useEffect(() => {
    try {
      setUpgraded(window.localStorage.getItem(SIGNED_OUT_REASON_KEY) === 'upgrade');
    } catch {
      setUpgraded(false);
    }
  }, []);

  // Already signed in: no reason to show the form.
  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email, password);
      try {
        window.localStorage.removeItem(SIGNED_OUT_REASON_KEY);
      } catch {
        // Nothing to clean up.
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">
          Life<span className="text-accent">Portal</span>
        </h1>
        <p className="mb-6 text-sm text-ink-muted">Sign in to see where you stand.</p>

        {resetDone && (
          <p role="status" className="card mb-4 p-4 text-sm">
            Your password was changed and every device was signed out. Sign in with the new password.
          </p>
        )}

        {upgraded && !resetDone && (
          <p role="status" className="card mb-4 p-4 text-sm text-ink-muted">
            We made sign-in more secure, so everyone has to sign in again once. Anything you saved
            on this device that hadn&apos;t been sent yet is still here and will be sent after you
            sign in.
          </p>
        )}

        <form onSubmit={submit} className="card space-y-4 p-5">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {error && <ErrorNote message={error} />}

          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
          {canReset && (
            <p className="text-center text-xs">
              <Link href="/forgot-password" className="text-ink-muted hover:underline">
                Forgot password?
              </Link>
            </p>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-ink-faint">
          No account yet?{' '}
          <Link href="/register" className="text-accent hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
