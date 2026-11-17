'use client';

import { THEME_V0_ID, type ActiveTheme } from '@life-portal/shared-types';
import { THEME_STORAGE_KEY, THEME_STYLE_ID, themeCss } from '@life-portal/shared-domain';

/**
 * Colour themes on the device (spec 037). The active theme is fetched after sign-in, applied
 * through one `<style>` element and kept in `localStorage`, where the pre-paint script in the
 * root layout finds it on the next open: no flash, and it works with no connection.
 *
 * What is kept is colours and a version: the same for every account, nothing about anyone, so
 * it is not one of the offline stores of spec 027 and it stays when someone signs out (the
 * sign-in screen then wears the same look).
 */

/** Fired after a theme is applied, so the status-bar colour can follow the new surface. */
export const THEME_APPLIED_EVENT = 'lp-theme-applied';

function styleElement(create: boolean): HTMLStyleElement | null {
  const found = document.getElementById(THEME_STYLE_ID);
  if (found instanceof HTMLStyleElement || !create) return found as HTMLStyleElement | null;
  const element = document.createElement('style');
  element.id = THEME_STYLE_ID;
  document.head.appendChild(element);
  return element;
}

/** Shows `theme` now. v0 is the stylesheet's own values, so applying it removes the override. */
export function applyTheme(theme: Pick<ActiveTheme, 'id' | 'light' | 'dark'>): void {
  if (theme.id === THEME_V0_ID) styleElement(false)?.remove();
  else {
    const element = styleElement(true);
    // `themeCss` re-validates every value: only `--role:r g b;` can come out of it.
    if (element) element.textContent = themeCss(theme);
  }
  window.dispatchEvent(new Event(THEME_APPLIED_EVENT));
}

/** Keeps `theme` for the next open. Storage being blocked only costs the offline copy. */
export function keepTheme(theme: ActiveTheme): void {
  try {
    if (theme.id === THEME_V0_ID) localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ id: theme.id, version: theme.version, light: theme.light, dark: theme.dark }));
  } catch {
    /* Private mode or a full disk: the theme still shows for this visit. */
  }
}

/** The kept theme's id and version, to tell whether a fetched one is news. */
export function keptThemeStamp(): string {
  try {
    const kept = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? 'null') as { id?: unknown; version?: unknown } | null;
    return kept && typeof kept.id === 'string' ? `${kept.id}@${String(kept.version)}` : `${THEME_V0_ID}@1`;
  } catch {
    return `${THEME_V0_ID}@1`;
  }
}

export const themeStamp = (theme: Pick<ActiveTheme, 'id' | 'version'>) => `${theme.id}@${theme.version}`;

/** A fetched active theme: applied and kept when it differs from what the device has. */
export function adoptTheme(theme: ActiveTheme): void {
  if (themeStamp(theme) === keptThemeStamp() && (theme.id === THEME_V0_ID) === !styleElement(false)) return;
  applyTheme(theme);
  keepTheme(theme);
}
