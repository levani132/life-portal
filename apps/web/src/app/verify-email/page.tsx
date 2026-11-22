'use client';
import { APP_NAME } from '../../lib/brand';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, request } from '../../lib/api';

/**
 * Confirms an email address from an emailed link (issue #27). Works signed in or not. The token
 * is in the fragment and is removed from the address bar before anything else happens.
 */
export default function VerifyEmailPage() {
  const [state, setState] = useState<'working' | 'done' | 'invalid' | 'error'>('working');

  useEffect(() => {
    const token = /(?:^|[#&])token=([A-Za-z0-9_-]+)/.exec(window.location.hash)?.[1] ?? '';
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setState('invalid');
      return;
    }
    request('/auth/verify-email', { method: 'POST', body: { token }, anonymous: true })
      .then(() => setState('done'))
      .catch((caught: unknown) => setState(caught instanceof ApiError && caught.code === 'VERIFY_INVALID' ? 'invalid' : 'error'));
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-4 text-lg font-semibold tracking-tight">Confirm your email</h1>
        <div role={state === 'invalid' || state === 'error' ? 'alert' : 'status'} className="card space-y-3 p-5 text-sm">
          {state === 'working' && <p>Confirming…</p>}
          {state === 'done' && <p>Your email is confirmed. Thank you.</p>}
          {state === 'invalid' && (
            <p>This link has expired or was already used. You can send a new one from Settings → Sign-in &amp; security.</p>
          )}
          {state === 'error' && <p>That did not work. Check your connection and open the link again.</p>}
          {state !== 'working' && (
            <Link href="/" className="btn-primary block w-full text-center">
              Open {APP_NAME}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
