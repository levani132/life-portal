/**
 * The assistant for pages (spec 041): an AI assistant, linked through the connector, acting as
 * a page its person manages. Everything it does as a page is counted and listed.
 */

/** What is counted against a page's daily caps. Reading is not counted. */
export const ASSISTANT_ACTION_KINDS = ['post', 'comment', 'like', 'follow', 'message', 'library', 'media'] as const;
export type AssistantActionKind = (typeof ASSISTANT_ACTION_KINDS)[number];

/** A cap per kind, per page, per day. `ASSISTANT_CAP_NONE` means no cap. */
export type AssistantCaps = Record<AssistantActionKind, number>;
export const ASSISTANT_CAP_NONE = -1;
export const ASSISTANT_CAP_MAX = 100_000;

/** The caps every page gets until the owner changes them. */
export const ASSISTANT_CAP_DEFAULTS: AssistantCaps = { post: 10, comment: 30, like: 100, follow: 30, message: 30, library: 200, media: 20 };

export const ASSISTANT_ACTION_LABELS: Record<AssistantActionKind, string> = {
  post: 'Posts',
  comment: 'Comments',
  like: 'Likes',
  follow: 'Follows',
  message: 'Messages',
  library: 'Library changes',
  media: 'Photo uploads',
};

/** One thing the assistant did as a page, as its managers see it. */
export interface AssistantAction {
  id: string;
  kind: AssistantActionKind;
  /** The tool that was called, e.g. `comment_on_post`. */
  tool: string;
  /** What it was done to: a post, a page, a conversation, a library item. */
  targetId?: string;
  createdAt: string;
}

export interface AssistantActivity {
  actions: AssistantAction[];
  /** Today's use against today's cap, per kind. `cap: null` means no cap. */
  today: { kind: AssistantActionKind; used: number; cap: number | null }[];
  /** What the assistant has queued for later as this page, soonest first. */
  scheduled: AssistantScheduledAction[];
}

/** Something the assistant asked to be done later as a page (spec 041). */
export interface AssistantScheduledAction {
  id: string;
  tool: string;
  /** When it is due, as an ISO timestamp. */
  at: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  /** Why it failed, in the words the tool would have answered. */
  error?: string;
}

/** How far ahead an action may be scheduled, and how far when it carries photos. */
export const ASSISTANT_SCHEDULE_MAX_DAYS = 7;
export const ASSISTANT_SCHEDULE_MEDIA_MAX_HOURS = 20;
/** How many actions may wait for one page at a time. */
export const ASSISTANT_SCHEDULE_MAX_PENDING = 500;

/** The owner's settings: the defaults, and one person's overrides (absent kinds use the default). */
export interface AssistantCapSettings {
  defaults: AssistantCaps;
}
export type AssistantCapOverride = Partial<AssistantCaps>;

/** Error codes the assistant can relay. */
export const ASSISTANT_ERROR_CODES = ['ASSISTANT_OFF', 'PAGE_NOT_AI', 'NOT_A_MANAGER', 'CAP_REACHED', 'PAGE_SUSPENDED', 'PAGE_DISABLED'] as const;
export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];
