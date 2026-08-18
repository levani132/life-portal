'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { ErrorNote, Field, Input } from '../../components/ui';

export default function RegisterPage() {
  const { register, user, loading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
          This holds your financial data, so pick a password you do not use anywhere else.
        </p>

        <form onSubmit={submit} className="card space-y-4 p-5">
          <Field label="Name">
            <Input required value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Password" hint="At least 10 characters.">
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={form.password}
              onChange={set('password')}
            />
          </Field>
          <Field label="Invite code" hint="Only needed if the server was configured with one.">
            <Input value={form.inviteCode} onChange={set('inviteCode')} />
          </Field>

          {error && <ErrorNote message={error} />}

          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-faint">
          Already have one?{' '}
          <Link href="/login" className="text-sky-400 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
