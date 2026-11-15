'use client';

import type { GoogleErrorCode, GoogleExchangeResult } from '@life-portal/shared-types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiError, request } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import {
  forgetGoogleBinding,
  googleBinding,
  googleErrorMessage,
  readGoogleReturn,
  safeReturnPath,
} from '../../../lib/google-signin';
import { ErrorNote, Field, Input, PasswordInput } from '../../../components/ui';
import { GoogleButton } from '../../../components/google-button';

type State =
  | { kind: 'working' }
  | { kind: 'error'; code: GoogleErrorCode }
  | { kind: 'needs_password'; email: string; ticket: string }
  | { kind: 'needs_invite'; email: string; ticket: string };

/**
 * Where the API sends the browser back after Google (issue #28). The fragment carries a one-time
 * code (or an error); it is removed from the address bar first, then traded together with the
 * binding secret this browser kept before leaving. The code works once, so it is sent once even
 * when React runs the effect twice.
 */
export default function GoogleReturnPage() {
  const { adopt } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'working' });
  const [binding, setBinding] = useState<string | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const answer = readGoogleReturn(window.location.hash);
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    const kept = googleBinding();
    setBinding(kept);
    if (!answer || 'error' in answer || !kept) {
      forgetGoogleBinding();
      setState({ kind: 'error', code: answer && 'error' in answer ? answer.error : 'expired' });
      return;
    }
    request<GoogleExchangeResult>('/auth/google/exchange', { method: 'POST', body: { code: answer.code, binding: kept }, anonymous: true })
      .then((result) => finish(result))
      .catch(() => {
        forgetGoogleBinding();
        setState({ kind: 'error', code: 'expired' });
      });
    // Runs once per arrival: `sent` guards the one-time code against a second run.
  }, []);

  function finish(result: GoogleExchangeResult) {
    if (result.kind === 'needs_password' || result.kind === 'needs_invite') {
      setState(result);
      return;
    }
    forgetGoogleBinding();
    if (result.kind === 'session') void adopt(result.session, safeReturnPath(result.returnTo));
    else if (result.kind === 'linked') router.replace(safeReturnPath(result.returnTo));
    else setState({ kind: 'error', code: result.code });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-4 text-lg font-semibold tracking-tight">
          Life<span className="text-accent">Portal</span>
        </h1>
        {state.kind === 'working' && (
          <p role="status" className="card p-5 text-sm">
            Signing you in with Google…
          </p>
        )}
        {state.kind === 'error' && <Failed code={state.code} />}
        {state.kind === 'needs_password' && binding && (
          <LinkWithPassword email={state.email} ticket={state.ticket} binding={binding} onDone={finish} />
        )}
        {state.kind === 'needs_invite' && binding && (
          <InviteOnly email={state.email} ticket={state.ticket} binding={binding} onDone={finish} />
        )}
      </div>
    </div>
  );
}

function Failed({ code }: { code: GoogleErrorCode }) {
  return (
    <div role="alert" className="card space-y-4 p-5 text-sm">
      <p>{googleErrorMessage(code)}</p>
      {code !== 'already_linked_elsewhere' && code !== 'account_has_google' && <GoogleButton label="Try again with Google" />}
      <Link href="/login" className="btn-ghost w-full">
        Sign in with email instead
      </Link>
    </div>
  );
}

const expiredOr = (caught: unknown, otherwise: string) =>
  caught instanceof ApiError && caught.status === 400 ? googleErrorMessage('expired') : caught instanceof ApiError ? caught.message : otherwise;

/**
 * The Google account's email already has an account here. Google saying so is not proof that
 * it is the same person, so linking takes that account's password, once.
 */
function LinkWithPassword(props: { email: string; ticket: string; binding: string; onDone: (result: GoogleExchangeResult) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      props.onDone(
        await request<GoogleExchangeResult>('/auth/google/link-with-password', {
          method: 'POST',
          body: { ticket: props.ticket, binding: props.binding, password },
          anonymous: true,
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 401 ? 'That password is not right.' : expiredOr(caught, 'Could not link Google.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div className="space-y-1 text-sm">
        <p className="font-medium">You already have an account</p>
        <p className="text-ink-muted">
          <span className="break-all text-ink">{props.email}</span> already signs in with a password. Enter it once to link
          Google; after that, either works.
        </p>
      </div>
      <input type="email" autoComplete="username" value={props.email} readOnly hidden />
      <Field label="Password">
        <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <ErrorNote message={error} />}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? 'Linking…' : 'Link Google and sign in'}
      </button>
      <p className="text-center text-xs">
        <Link href="/forgot-password" className="text-ink-muted hover:underline">
          Forgot password?
        </Link>
      </p>
    </form>
  );
}

/** Sign-up is invite-only on this server: a new account from Google needs the code too. */
function InviteOnly(props: { email: string; ticket: string; binding: string; onDone: (result: GoogleExchangeResult) => void }) {
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      props.onDone(
        await request<GoogleExchangeResult>('/auth/google/complete-signup', {
          method: 'POST',
          body: { ticket: props.ticket, binding: props.binding, inviteCode },
          anonymous: true,
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 403 ? 'That invite code is not right.' : expiredOr(caught, 'Could not create the account.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div className="space-y-1 text-sm">
        <p className="font-medium">Create your account</p>
        <p className="text-ink-muted">
          Sign-up needs an invitation. Enter your invite code to create an account for{' '}
          <span className="break-all text-ink">{props.email}</span>.
        </p>
      </div>
      <Field label="Invite code">
        <Input required value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
      </Field>
      {error && <ErrorNote message={error} />}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}
