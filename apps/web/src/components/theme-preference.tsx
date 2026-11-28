'use client';
import { APP_NAME } from '../lib/brand';
import { useEffect, useSyncExternalStore } from 'react';
import { THEME_APPLIED_EVENT } from '../lib/theme-runtime';
import { Field, Panel, Select } from './ui';

const STORAGE_KEY = 'lp.theme.v1';
const CHANGE_EVENT = 'lp-theme-change';
type ThemePreference = 'system' | 'light' | 'dark';
let sessionPreference: ThemePreference = 'system';

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return sessionPreference;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function usePreference() {
  return useSyncExternalStore(
    subscribe,
    readPreference,
    () => 'system' as const,
  );
}

/** `12 14 20` as `#0c0e14`: hex is what every Android browser reads in `theme-color`. */
function hex(rgb: string) {
  return `#${rgb
    .split(' ')
    .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Every `theme-color` tag (there is one per colour scheme), so whichever one Android reads says
 * the colour actually in use, also when the app's theme differs from the phone's.
 */
function setThemeColor(colour: string) {
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', colour));
}

/** Keep native controls and browser chrome aligned with the resolved palette. */
export function ThemeSync() {
  const preference = usePreference();
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    function apply() {
      const theme =
        preference === 'system'
          ? media.matches
            ? 'dark'
            : 'light'
          : preference;
      document.documentElement.dataset.theme = theme;
      // The status bar takes the page's surface, whatever theme set it (spec 037).
      // Spec 048: while a portal's wallpaper is on screen, the bar takes the wallpaper's top colour.
      const wallpaperTop = document.documentElement.dataset.wallpaperTop;
      if (wallpaperTop) {
        setThemeColor(wallpaperTop);
        return;
      }
      const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
      const fallback = theme === 'dark' ? '#0c0e14' : '#f5f7fa';
      setThemeColor(/^\d{1,3} \d{1,3} \d{1,3}$/.test(surface) ? hex(surface) : fallback);
    }
    apply();
    media.addEventListener('change', apply);
    window.addEventListener(THEME_APPLIED_EVENT, apply);
    return () => {
      media.removeEventListener('change', apply);
      window.removeEventListener(THEME_APPLIED_EVENT, apply);
    };
  }, [preference]);
  return null;
}

export function ThemePreferenceControl() {
  const preference = usePreference();
  return (
    <Panel
      title="Appearance"
      description={`Choose how ${APP_NAME} looks in this browser.`}
    >
      <Field
        label="Theme"
        hint="System default follows your device’s light or dark appearance automatically."
      >
        <Select
          value={preference}
          onChange={(event) => {
            const next = event.target.value as ThemePreference;
            sessionPreference = next;
            try {
              localStorage.setItem(STORAGE_KEY, next);
            } catch {
              /* Keep the preference in memory when storage is blocked. */
            }
            window.dispatchEvent(new Event(CHANGE_EVENT));
          }}
        >
          <option value="light">Light</option>
          <option value="system">System default</option>
          <option value="dark">Dark</option>
        </Select>
      </Field>
    </Panel>
  );
}
