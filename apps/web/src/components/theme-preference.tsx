'use client';

import { useEffect, useSyncExternalStore } from 'react';
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
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'dark' ? '#0c0e14' : '#f5f7fa');
    }
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);
  return null;
}

export function ThemePreferenceControl() {
  const preference = usePreference();
  return (
    <Panel
      title="Appearance"
      description="Choose how Life Portal looks in this browser."
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
