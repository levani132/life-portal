import type { Id, IsoDate, Timestamped } from './common';

/**
 * Widgets 5, 6 and 7 — "EPAM work", "Client project", "SoulArt", "ShopIt".
 *
 * These four screens are the same shape with different names, so they share one `Board`
 * collection keyed by `key`. A board opts into extra sections via `features`, which is how
 * the EPAM board gets people management and Talent-Partner contribution tracking without
 * the SoulArt board carrying dead UI.
 */

export const BOARD_KINDS = ['employer', 'client_project', 'side_project'] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

export const BOARD_FEATURES = [
  /** Prioritised task list. Every board has this. */
  'tasks',
  /** Free-form notes. Every board has this. */
  'notes',
  /** Direct reports with attention states. EPAM only. */
  'people',
  /** Talent-Partner perk-earning activities and promotion progress. EPAM only. */
  'contributions',
  /** Performance-review evidence log. EPAM + client project. */
  'wins',
] as const;
export type BoardFeature = (typeof BOARD_FEATURES)[number];

export interface Board extends Timestamped {
  id: Id;
  userId: Id;
  /** Stable slug used in URLs and by the seed, e.g. `epam`, `client-project`. */
  key: string;
  name: string;
  kind: BoardKind;
  description?: string;
  /** Tailwind-friendly accent token, e.g. `violet`. */
  accent: string;
  features: BoardFeature[];
  order: number;
  archived: boolean;
}

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 1 = drop everything, 4 = someday. */
export type Priority = 1 | 2 | 3 | 4;

export interface BoardTask extends Timestamped {
  id: Id;
  userId: Id;
  boardId: Id;
  title: string;
  notes?: string;
  status: TaskStatus;
  priority: Priority;
  dueDate?: IsoDate;
  tags: string[];
  /** Why this matters — drives the "what moves the needle" sort. */
  impact?: 'promotion' | 'performance_review' | 'revenue' | 'maintenance' | 'learning';
  /** Rough effort in hours, for planning a week. */
  estimateHours?: number;
  order: number;
  completedAt?: IsoDate;
  blockedReason?: string;
}

export interface BoardNote extends Timestamped {
  id: Id;
  userId: Id;
  boardId: Id;
  title: string;
  body: string;
  pinned: boolean;
  tags: string[];
}

export const ATTENTION_STATES = [
  /** Nothing needed. */
  'ok',
  /** Needs something from me now. */
  'needs_attention',
  /** Will need something by `nextCheckIn` — the "will require at some point" case. */
  'upcoming',
  /** Actively at risk: attrition, performance, unhappy client. */
  'at_risk',
] as const;
export type AttentionState = (typeof ATTENTION_STATES)[number];

/** A direct report on the EPAM board. */
export interface Person extends Timestamped {
  id: Id;
  userId: Id;
  boardId: Id;
  name: string;
  role?: string;
  /** EPAM grade, e.g. `A3`, `Senior`. */
  level?: string;
  /** Client project they are staffed on. */
  project?: string;
  email?: string;
  attentionState: AttentionState;
  /** Required when `attentionState !== 'ok'` — the "why" the user asked for. */
  attentionReason?: string;
  /** When the upcoming need becomes current, or the next 1:1 is due. */
  nextCheckIn?: IsoDate;
  lastOneOnOne?: IsoDate;
  /** Cadence in days between 1:1s; drives an overdue flag. */
  oneOnOneCadenceDays?: number;
  /** Next promotion or assessment date to prepare for. */
  nextReviewDate?: IsoDate;
  notes?: string;
  archived: boolean;
}

/**
 * A perk-earning activity for the Talent Partner role: interviews conducted, referrals,
 * staffing help, mentoring. Tracked because these accumulate towards promotion.
 */
export const CONTRIBUTION_TYPES = [
  'interview',
  'referral',
  'hire_closed',
  'staffing_help',
  'mentoring',
  'internal_activity',
  'certification',
  'article_or_talk',
  'other',
] as const;
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

export interface Contribution extends Timestamped {
  id: Id;
  userId: Id;
  boardId: Id;
  type: ContributionType;
  title: string;
  date: IsoDate;
  /** Weight towards the promotion score. Defaults come from `CONTRIBUTION_POINTS`. */
  points: number;
  outcome?: string;
  /** Related person, when the contribution was about someone. */
  personId?: Id;
  note?: string;
}

/** Default promotion-score weight per contribution type. Tune freely; it is only a nudge. */
export const CONTRIBUTION_POINTS: Record<ContributionType, number> = {
  interview: 2,
  referral: 3,
  hire_closed: 8,
  staffing_help: 4,
  mentoring: 3,
  internal_activity: 2,
  certification: 5,
  article_or_talk: 4,
  other: 1,
};

/** Evidence for a performance review — the "show off to the client" log. */
export interface Win extends Timestamped {
  id: Id;
  userId: Id;
  boardId: Id;
  title: string;
  date: IsoDate;
  /** What changed because of it, ideally with a number. */
  impact?: string;
  /** Who noticed. Useful when asking for a reference. */
  witnesses: string[];
  tags: string[];
  note?: string;
}

export interface BoardSummary {
  boardId: Id;
  key: string;
  name: string;
  kind: BoardKind;
  accent: string;
  features: BoardFeature[];
  openTaskCount: number;
  /** Priority-1 and priority-2 open tasks. */
  urgentTaskCount: number;
  overdueTaskCount: number;
  nextDueDate?: IsoDate;
  topTasks: { id: Id; title: string; priority: Priority; dueDate?: IsoDate }[];
  /** People sections only. */
  peopleCount?: number;
  needsAttentionCount?: number;
  upcomingAttentionCount?: number;
  overdueOneOnOneCount?: number;
  /** Contributions sections only. */
  contributionPointsLast6Months?: number;
  contributionCountLast6Months?: number;
  winCount?: number;
}
