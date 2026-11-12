import type { FeatureId } from './portal';

/** Profile badges (spec 022). The catalogue only grows; ids are never reused. */
export const BADGE_FAMILIES = ['standard', 'food', 'training'] as const;
export type BadgeFamily = (typeof BADGE_FAMILIES)[number];

export const BADGE_IDS = [
  'setup',
  'firstPost',
  'firstFriend',
  'connected',
  'earlyMember',
  'loggingStreak',
  'onTargetStreak',
  'daysOnTarget',
  'firstWorkout',
  'workouts',
  'consistency',
] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

export type BadgeUnit = 'days' | 'weeks' | 'workouts' | 'friends';

export interface BadgeDefinition {
  id: BadgeId;
  family: BadgeFamily;
  /** Shown on the badge. `{tier}` is replaced by the tier for tiered badges. */
  name: string;
  /** What earns it. `{tier}` is replaced by the tier. */
  description: string;
  unit?: BadgeUnit;
  /** Ascending thresholds; `[1]` for an untiered badge. */
  tiers: number[];
  /** Every flag must be on for the badge to be shown. Always includes `social`. */
  requires: FeatureId[];
  /** A key the web maps to an icon. */
  icon: string;
}

export const BADGE_CATALOGUE: readonly BadgeDefinition[] = [
  {
    id: 'setup',
    family: 'standard',
    name: 'Set up',
    description: 'Finished setting up the portal.',
    tiers: [1],
    requires: ['social'],
    icon: 'sparkles',
  },
  {
    id: 'firstPost',
    family: 'standard',
    name: 'First post',
    description: 'Published a first post.',
    tiers: [1],
    requires: ['social', 'foodPosts'],
    icon: 'post',
  },
  {
    id: 'firstFriend',
    family: 'standard',
    name: 'First friend',
    description: 'Made a first friend here.',
    tiers: [1],
    requires: ['social'],
    icon: 'friend',
  },
  {
    id: 'connected',
    family: 'standard',
    name: 'Connected',
    description: 'Has {tier} friends here.',
    unit: 'friends',
    tiers: [10],
    requires: ['social'],
    icon: 'friends',
  },
  {
    id: 'earlyMember',
    family: 'standard',
    name: 'Early member',
    description: 'Joined while the portal was still being built.',
    tiers: [1],
    requires: ['social'],
    icon: 'seedling',
  },
  {
    id: 'loggingStreak',
    family: 'food',
    name: '{tier}-day logging streak',
    description: 'Logged food {tier} days in a row.',
    unit: 'days',
    tiers: [7, 30, 100, 365],
    requires: ['social', 'nutrition'],
    icon: 'flame',
  },
  {
    id: 'onTargetStreak',
    family: 'food',
    name: '{tier} days on target',
    description:
      'Ate within 10% of the calorie target {tier} days in a row. Judged against the starting target (before activity) and the goal set at the time it was checked; cheat days are skipped.',
    unit: 'days',
    tiers: [7, 30],
    requires: ['social', 'nutrition'],
    icon: 'target',
  },
  {
    id: 'daysOnTarget',
    family: 'food',
    name: '{tier} target days',
    description:
      'Ate within 10% of the calorie target on {tier} days in all. Judged against the starting target (before activity).',
    unit: 'days',
    tiers: [30, 100, 365],
    requires: ['social', 'nutrition'],
    icon: 'check',
  },
  {
    id: 'firstWorkout',
    family: 'training',
    name: 'First workout',
    description: 'Finished a first workout.',
    tiers: [1],
    requires: ['social', 'training'],
    icon: 'dumbbell',
  },
  {
    id: 'workouts',
    family: 'training',
    name: '{tier} workouts',
    description: 'Finished {tier} workouts.',
    unit: 'workouts',
    tiers: [10, 50, 100, 250],
    requires: ['social', 'training'],
    icon: 'dumbbell',
  },
  {
    id: 'consistency',
    family: 'training',
    name: '{tier}-week consistency',
    description: 'Trained at least twice a week for {tier} weeks in a row.',
    unit: 'weeks',
    tiers: [4, 12, 26, 52],
    requires: ['social', 'training'],
    icon: 'calendar',
  },
];

/** Accounts created before this day are early members. `null` while the app is in testing: everyone. */
export const EARLY_MEMBER_CUTOFF: string | null = null;
export const MAX_EQUIPPED_BADGES = 3;

/** The owner's own view of one badge. */
export interface BadgeView {
  badgeId: BadgeId;
  /** Highest earned tier; absent while locked. */
  tier?: number;
  earnedOn?: string;
  tiersEarned: { tier: number; earnedOn: string }[];
  /** Toward the lowest unearned tier. Owner only. */
  progress?: { current: number; next: number };
  /** Awarded by the request that returned it. */
  isNew?: boolean;
}

export interface MyBadges {
  badges: BadgeView[];
  equipped: BadgeId[];
}

/** What other people see: an equipped badge, nothing more. */
export interface PublicBadge {
  badgeId: BadgeId;
  tier: number;
  earnedOn: string;
}

export interface PersonBadges {
  equipped: PublicBadge[];
}

export interface EquipBadgesBody {
  badgeIds: BadgeId[];
}

export interface BadgeCheckResult {
  newBadgeIds: BadgeId[];
}

export function badgeDefinition(id: string): BadgeDefinition | undefined {
  return BADGE_CATALOGUE.find((badge) => badge.id === id);
}

/** Fills `{tier}` in a badge's name or description. */
export function badgeText(text: string, tier: number): string {
  return text.replace(/\{tier\}/g, String(tier));
}
