/**
 * Pages (spec 040): accounts that are not a person. A person who manages one acts as it; the
 * app then shows and does everything as the page.
 */

/** The header that names the page a request is made as. Absent: the signed-in person. */
export const ACT_AS_HEADER = 'x-lp-act-as';

/** How many pages a person may create unless the owner set another limit for them. */
export const PAGE_LIMIT_DEFAULT = 3;
/** `pageLimit` value meaning "no limit". */
export const PAGE_LIMIT_NONE = -1;

export const PAGE_NAME_MAX = 80;
export const PAGE_BIO_MAX = 300;

/** A page as its manager sees it in the switcher and the pages list. */
export interface PageSummary {
  id: string;
  name: string;
  username: string;
  bio: string;
  avatarUrl?: string;
  /** Run with AI, as its manager declared. */
  aiManaged: boolean;
  /** The app's own page. */
  official: boolean;
  suspended: boolean;
}

/** A page offered to follow. */
export interface SuggestedPage {
  userId: string;
  displayName: string;
  username: string;
  bio: string;
  avatarUrl?: string;
  official?: true;
  followerCount: number;
}

export interface MyPages {
  pages: PageSummary[];
  /** How many more this person may create; `null` when there is no limit. */
  remaining: number | null;
}

export interface CreatePageRequest {
  name: string;
  username: string;
  bio?: string;
}

export interface UpdatePageRequest {
  name: string;
  username: string;
  bio: string;
  aiManaged?: boolean;
}

/** Who the app is being used as right now. */
export type Identity =
  | { kind: 'person'; id: string }
  | { kind: 'page'; id: string; page: PageSummary; personId: string };

/** Error codes of the pages routes and the acting check. */
export const PAGE_ERROR_CODES = ['PAGE_LIMIT', 'USERNAME_TAKEN', 'NOT_A_MANAGER', 'NOT_FOR_PAGES', 'PAGES_OFF'] as const;
export type PageErrorCode = (typeof PAGE_ERROR_CODES)[number];
