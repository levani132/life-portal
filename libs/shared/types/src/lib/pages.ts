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
  /** Spec 041: switched off by its manager; hidden everywhere until switched on again. */
  disabled: boolean;
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
  /** Spec 041: whether a linked AI assistant may act as the pages marked "run with AI". */
  assistant: boolean;
  /** The person's own profile photo, for their row in "Using the app as" while acting as a page. */
  personAvatarUrl?: string;
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

/** How high the owner may set one person's page limit. */
export const PAGE_LIMIT_MAX = 1000;

/** One account on the owner's People screen (developer only). */
export interface AdminAccount {
  id: string;
  kind: 'person' | 'page';
  name: string;
  username?: string;
  suspended: boolean;
  /** A person: the limit set for them (`-1`: none), absent for the default; and how many they created. */
  pageLimit?: number;
  pagesCreated?: number;
  /** Spec 041: the owner's override of the assistant's daily caps for this person. */
  assistantCaps?: Record<string, number>;
  developer?: true;
  /** A page: its marks, its followers and who manages it. */
  official?: boolean;
  aiManaged?: boolean;
  followerCount?: number;
  managers?: string[];
}

export interface AdminAccountsPage {
  accounts: AdminAccount[];
  hasMore: boolean;
}

/** `limit: null` returns the person to the default. */
export interface SetPageLimitRequest {
  limit: number | null;
}

/** Who the app is being used as right now. */
export type Identity =
  | { kind: 'person'; id: string }
  | { kind: 'page'; id: string; page: PageSummary; personId: string };

/** Error codes of the pages routes and the acting check. */
export const PAGE_ERROR_CODES = ['PAGE_LIMIT', 'USERNAME_TAKEN', 'NOT_A_MANAGER', 'NOT_FOR_PAGES', 'PAGES_OFF', 'PAGE_DISABLED'] as const;
export type PageErrorCode = (typeof PAGE_ERROR_CODES)[number];

/** Spec 045: one post on a page's insights. Counts only. */
export interface PageInsightsPost {
  id: string;
  /** The title, or the start of the caption. */
  label: string;
  createdAt: string;
  views: number;
  likes: number;
  comments: number;
  reposts: number;
  /** People who saved something from it into their own library. */
  saves: number;
}

/**
 * Spec 045: a page's insights, for its managers. `days` is the window of the totals and of
 * `newFollowersByDay` (oldest first). A view is a person seeing a post, once per person, post
 * and day; nothing records who.
 */
export interface PageInsights {
  days: number;
  followers: number;
  newFollowersByDay: { day: string; count: number }[];
  totals: { views: number; likes: number; comments: number; reposts: number; newFollowers: number };
  /** The page's 30 newest posts, newest first, with counts since they were posted. */
  posts: PageInsightsPost[];
}

/** Spec 045: a page's managers and pending invitations, for its managers only. */
export interface PageManagers {
  managers: { userId: string; name: string; username: string; avatarUrl?: string; creator: boolean; you: boolean; mayRemove: boolean }[];
  invites: { id: string; userId: string; name: string; username: string; avatarUrl?: string; createdAt: string }[];
}

/** Spec 045: an invitation to help run a page, as the invited person sees it. */
export interface PageInvite {
  id: string;
  page: { id: string; name: string; username: string; avatarUrl?: string };
  invitedBy: string;
  createdAt: string;
}
