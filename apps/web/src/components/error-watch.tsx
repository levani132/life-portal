'use client';

import { useEffect } from 'react';
import { useAuth } from '../lib/auth-context';
import { reportError } from '../lib/error-reporting';

/**
 * Reports what breaks on the page to the server's error log: uncaught errors and rejected
 * promises nobody handled. Only while signed in (the route needs a session). Mounted once.
 */
export function ErrorWatch() {
  const { user } = useAuth();
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return;
    const onError = (event: ErrorEvent) => reportError(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportError(event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [signedIn]);
  return null;
}
