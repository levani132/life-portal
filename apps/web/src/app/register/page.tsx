'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { authCapabilities } from '../../lib/auth-capabilities';
import { ErrorNote, Field, Input } from '../../components/ui';
import { GoogleButton, OrDivider } from '../../components/google-button';
import { LegalAgreement } from '../../components/legal-page';
import { APP_WORDMARK } from '../../lib/brand';

export default function RegisterPage() {
  const { register, user, loading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [canGoogle, setCanGoogle] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    void authCapabilities().then((caps) => setCanGoogle(caps.google));
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        // Only sent when filled in; the API requires it if the server sets an invite code.
        inviteCode: form.inviteCode || undefined,
        agreed,
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the account.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">Create your portal</h1>
        <p className="mb-6 text-sm text-ink-muted">
          Keep your personal information safe with a password you don’t use anywhere else.
        </p>

        <form onSubmit={submit} className="card space-y-4 p-5">
          {/* One box for both ways of signing up: health information needs a clear yes. */}
          <label className="flex items-start gap-3 text-sm text-ink-muted">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--accent-solid))]"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              required
            />
            <span>
              I agree that {APP_WORDMARK} stores the health information I enter, such as food, body weight and
              training, to show it back to me and to the people I choose.
            </span>
          </label>
          {canGoogle && (
            <>
              <div className={agreed ? undefined : 'pointer-events-none opacity-50'} aria-disabled={!agreed}>
                <GoogleButton label="Sign up with Google" />
              </div>
              <OrDivider />
            </>
          )}
          <Field label="Name">
            <Input required value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Password" hint="At least 10 characters, and not a common password.">
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={form.password}
              onChange={set('password')}
            />
          </Field>
          <Field label="Invite code" hint="Enter it if you were given an invitation.">
            <Input value={form.inviteCode} onChange={set('inviteCode')} />
          </Field>

          {error && <ErrorNote message={error} />}

          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? 'Creating…' : 'Create account'}
          </button>
          <LegalAgreement action="creating an account" />
        </form>

        <p className="mt-4 text-center text-xs text-ink-faint">
          Already have one?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
