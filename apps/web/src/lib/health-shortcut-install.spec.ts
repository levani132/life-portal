import {
  healthShortcutPromptKind,
  healthShortcutInstallKey,
  readHealthShortcutInstall,
  writeHealthShortcutInstall,
  snoozeHealthShortcut,
} from './health-shortcut-install';
import { HEALTH_SYNC_INTERVAL_MS } from './health-sync';
const first = `https://www.icloud.com/shortcuts/${'a'.repeat(32)}`;
const next = `https://www.icloud.com/shortcuts/${'b'.repeat(32)}`;
beforeEach(() => localStorage.clear());

it('distinguishes unconfirmed installation, pending approval, and a new published URL', () => {
  expect(healthShortcutPromptKind(first, {}, 0)).toBe('install');
  expect(healthShortcutPromptKind(first, { pendingUrl: first }, 0)).toBe(
    'confirm',
  );
  expect(
    healthShortcutPromptKind(first, { installedUrl: first }, 0),
  ).toBeNull();
  expect(healthShortcutPromptKind(next, { installedUrl: first }, 0)).toBe(
    'update',
  );
});
it('persists a six-hour postponement across reloads without blocking an existing installation', () => {
  writeHealthShortcutInstall(
    'person',
    snoozeHealthShortcut(next, { installedUrl: first }, 100),
  );
  const state = readHealthShortcutInstall('person');
  expect(
    healthShortcutPromptKind(next, state, 100 + HEALTH_SYNC_INTERVAL_MS - 1),
  ).toBeNull();
  expect(
    healthShortcutPromptKind(
      next,
      state,
      100 + HEALTH_SYNC_INTERVAL_MS - 1,
      true,
    ),
  ).toBeNull();
  expect(
    healthShortcutPromptKind(next, state, 100 + HEALTH_SYNC_INTERVAL_MS),
  ).toBe('update');
});
it('declines only the offered release and offers missing installation again on explicit sync', () => {
  const state = { installedUrl: first, declinedUrl: next };
  expect(healthShortcutPromptKind(next, state, 0)).toBeNull();
  expect(
    healthShortcutPromptKind(
      `https://www.icloud.com/shortcuts/${'c'.repeat(32)}`,
      state,
      0,
    ),
  ).toBe('update');
  expect(healthShortcutPromptKind(first, { declinedUrl: first }, 0)).toBeNull();
  expect(healthShortcutPromptKind(first, { declinedUrl: first }, 0, true)).toBe(
    'install',
  );
});
it('isolates users, recovers from invalid storage and refuses non-Shortcut links', () => {
  writeHealthShortcutInstall('person', { installedUrl: first });
  expect(readHealthShortcutInstall('other')).toEqual({});
  localStorage.setItem(healthShortcutInstallKey('person'), 'broken');
  expect(readHealthShortcutInstall('person')).toEqual({});
  expect(healthShortcutPromptKind('javascript:alert(1)', {}, 0)).toBeNull();
});
