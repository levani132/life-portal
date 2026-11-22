'use client';
import { APP_NAME } from '../../lib/brand';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, request } from '../../lib/api';
import { authCapabilities } from '../../lib/auth-capabilities';
import { ErrorNote, Field, Input } from '../../components/ui';

/**
 * Asks for a reset link (issue #27). The answer is the same whether or not the email has an
 * account, so this page never says which.
 */
export default function ForgotPasswordPage() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void authCapabilities().then((caps) => setAvailable(caps.passwordReset));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const answer = await request<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: { email },
        anonymous: true,
      });
      setSent(answer.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send the link. Check your connection.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">Reset your password</h1>
        <p className="mb-6 text-sm text-ink-muted">We&apos;ll email you a link to choose a new one.</p>

        {available === false ? (
          <p role="status" className="card p-5 text-sm text-ink-muted">
            Password reset by email isn&apos;t available on this {APP_NAME} yet. Ask the person who runs it.
          </p>
        ) : sent ? (
          <p role="status" className="card p-5 text-sm">
            {sent}
          </p>
        ) : (
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
            {error && <ErrorNote message={error} />}
            <button type="submit" className="btn-primary w-full" disabled={pending || available === null}>
              {pending ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-ink-faint">
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
