import { HEALTH_SYNC_INTERVAL_MS } from './health-sync';

export interface HealthShortcutInstall {
  installedUrl?: string;
  pendingUrl?: string;
  declinedUrl?: string;
  snoozedUrl?: string;
  remindAt?: number;
}
export type HealthShortcutPromptKind = 'install' | 'update' | 'confirm';
export const healthShortcutInstallKey = (userId: string) =>
  `lp.health.shortcut.v1.${userId}`;
export const validHealthShortcutUrl = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^https:\/\/www\.icloud\.com\/shortcuts\/[a-f0-9]{32}$/i.test(value);

export function readHealthShortcutInstall(
  userId: string,
): HealthShortcutInstall {
  try {
    const raw = JSON.parse(
      localStorage.getItem(healthShortcutInstallKey(userId)) ?? '{}',
    );
    if (!raw || typeof raw !== 'object') return {};
    return {
      installedUrl: validHealthShortcutUrl(raw.installedUrl)
        ? raw.installedUrl
        : undefined,
      pendingUrl: validHealthShortcutUrl(raw.pendingUrl)
        ? raw.pendingUrl
        : undefined,
      declinedUrl: validHealthShortcutUrl(raw.declinedUrl)
        ? raw.declinedUrl
        : undefined,
      snoozedUrl: validHealthShortcutUrl(raw.snoozedUrl)
        ? raw.snoozedUrl
        : undefined,
      remindAt:
        typeof raw.remindAt === 'number' && Number.isFinite(raw.remindAt)
          ? raw.remindAt
          : undefined,
    };
  } catch {
    return {};
  }
}
export function writeHealthShortcutInstall(
  userId: string,
  state: HealthShortcutInstall,
) {
  try {
    localStorage.setItem(
      healthShortcutInstallKey(userId),
      JSON.stringify(state),
    );
  } catch {
    /* Storage can be disabled; the current tab also keeps this state in memory. */
  }
}
export function healthShortcutPromptKind(
  url: string,
  state: HealthShortcutInstall,
  now: number,
  manual = false,
): HealthShortcutPromptKind | null {
  if (!validHealthShortcutUrl(url)) return null;
  if (state.pendingUrl === url) return 'confirm';
  if (state.installedUrl === url) return null;
  // A manual sync must offer setup again when no installation has been confirmed.
  if (!(manual && !state.installedUrl)) {
    if (state.declinedUrl === url) return null;
    if (state.snoozedUrl === url && (state.remindAt ?? 0) > now) return null;
  }
  return state.installedUrl ? 'update' : 'install';
}
export function snoozeHealthShortcut(
  url: string,
  state: HealthShortcutInstall,
  now: number,
): HealthShortcutInstall {
  return {
    ...state,
    pendingUrl: undefined,
    snoozedUrl: url,
    remindAt: now + HEALTH_SYNC_INTERVAL_MS,
  };
}
/** Only user gestures call this; opening an installation link does not prove installation. */
export function openHealthShortcut(url: string) {
  window.location.assign(url);
}
