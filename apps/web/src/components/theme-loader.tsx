'use client';

import { useEffect } from 'react';
import type { ActiveTheme } from '@life-portal/shared-types';
import { useAuth } from '../lib/auth-context';
import { RECOVERS, useApi } from '../lib/hooks';
import { adoptTheme } from '../lib/theme-runtime';

/** The path of the active theme; the admin page refreshes it after activating or saving. */
export const ACTIVE_THEME_KEY = '/themes/active';

/**
 * Spec 037: fetches the active colour theme once someone is signed in, and again when the app
 * returns to the foreground or the network comes back, so a theme the admin activates reaches
 * every device without a reload. With no connection nothing happens: the kept theme, applied
 * before the first paint, stays.
 */
export function ThemeLoader() {
  const { user } = useAuth();
  const { data } = useApi<ActiveTheme>(user ? ACTIVE_THEME_KEY : null, RECOVERS as never);
  useEffect(() => {
    if (data) adoptTheme(data);
  }, [data]);
  return null;
}
