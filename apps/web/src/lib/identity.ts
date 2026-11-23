import { ACT_AS_HEADER } from '@life-portal/shared-types';

/**
 * Which identity this device is using (spec 040): the signed-in person, or one of the pages they
 * manage. The choice is kept per device. While it names a page, every request carries the page's
 * id in a header and the server answers as the page.
 *
 * Switching reloads the app. Everything on screen and everything kept in memory belongs to one
 * identity, and starting again is the one way to be sure none of it carries over.
 */
const KEY = 'lp.acting.v1';

/** The page used most recently on this device, kept after switching back: a double tap on the profile tab returns to it. */
const LAST_KEY = 'lp.acting.last';

let cached: string | null | undefined;

/** The page being acted as, or `null` for the person. */
export function actingPageId(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
  } catch {
    cached = null;
  }
  return cached;
}

export function rememberActingPage(pageId: string | null): void {
  cached = pageId;
  try {
    if (pageId) {
      window.localStorage.setItem(KEY, pageId);
      window.localStorage.setItem(LAST_KEY, pageId);
    } else window.localStorage.removeItem(KEY);
  } catch {
    // Without storage the choice lasts until the next reload.
  }
}

/** The page this device used last, if any. It may since have been deleted or switched off. */
export function lastActingPageId(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/** The header that makes a request the page's, when acting as one. */
export function actingHeaders(): Record<string, string> {
  const pageId = actingPageId();
  return pageId ? { [ACT_AS_HEADER]: pageId } : {};
}

/** The server's answers that mean "you can no longer act as that page". */
export const ACTING_ENDED_CODES = ['NOT_A_MANAGER', 'PAGE_SUSPENDED', 'PAGE_DISABLED'];

/** Goes back to the person and starts the app again. */
export function stopActing(): void {
  rememberActingPage(null);
  if (typeof window !== 'undefined') window.location.assign('/');
}
