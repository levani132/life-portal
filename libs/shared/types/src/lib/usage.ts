/**
 * Numbers: how the app is used, for the developer (roadmap step 3). Totals only, computed on
 * read from records the app already stores. Nothing here names or identifies a person.
 */
export const USAGE_RANGES = [7, 30, 90] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

/** What a person did on a day. `social`: commented, liked or sent a message. */
export const USAGE_KINDS = ['food', 'training', 'weight', 'post', 'social'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export interface UsageDay {
  day: string;
  /** Accounts created that day. */
  newAccounts: number;
  /** People who did at least one thing that day. */
  active: number;
  /** People who logged food, trained, or posted that day. */
  food: number;
  training: number;
  posted: number;
}

export interface UsageRetention {
  /** Days since the account was created. */
  afterDays: number;
  /** Accounts old enough to be counted (created in the look-back window, at least `afterDays` ago). */
  eligible: number;
  /** Of those, how many did something on that day or later. */
  returned: number;
}

export interface UsageReport {
  range: UsageRange;
  today: string;
  /** Every account that exists, suspended ones included. */
  totalAccounts: number;
  newAccounts: number;
  /** People active today, in the last 7 days and in the last 30 days (each ending today). */
  activeToday: number;
  active7: number;
  active30: number;
  /** People who did each thing at least once in the range. */
  people: Record<UsageKind, number>;
  /** Of the accounts created in the range, how many did anything at all. */
  newAccountsActivated: number;
  retention: UsageRetention[];
  days: UsageDay[];
}

/** How far back accounts are looked at for retention. */
export const USAGE_RETENTION_WINDOW_DAYS = 90;
export const USAGE_RETENTION_STEPS = [1, 7, 30] as const;
