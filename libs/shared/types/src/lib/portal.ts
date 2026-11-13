/** Product modules are distinct from the collections/services that implement them. */
export const MODULE_IDS = [
  'nutrition',
  'money',
  'stocks',
  'loans',
  'items',
  'personal',
  'projects',
  'epam',
  'training',
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export const COHORTS = ['production', 'internal'] as const;
export type UserCohort = (typeof COHORTS)[number];
export const FEATURE_IDS = [
  ...MODULE_IDS,
  'social',
  'foodPosts',
  'push',
  'messages',
  'postMedia',
  'forYou',
  'trainingLevels',
  'forYouRanking',
] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];
export type FeatureAccess = Record<FeatureId, boolean>;
export const AUDIENCES = ['private', 'friends', 'public'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const MODULES: {
  id: ModuleId;
  name: string;
  description: string;
  href: string;
}[] = [
  {
    id: 'nutrition',
    name: 'Food',
    description: 'Meals, foods and nutrition goals',
    href: '/nutrition',
  },
  {
    id: 'money',
    name: 'Money',
    description: 'Your balance, budget and spending',
    href: '/cashflow',
  },
  {
    id: 'stocks',
    name: 'Stocks',
    description: 'Holdings and investment plans',
    href: '/stocks',
  },
  {
    id: 'loans',
    name: 'Debts',
    description: 'Loans and repayment plans',
    href: '/loans',
  },
  {
    id: 'items',
    name: 'Items to sell',
    description: 'Things you plan to sell',
    href: '/items',
  },
  {
    id: 'personal',
    name: 'Personal life',
    description: 'Plans and moments to look forward to',
    href: '/personal',
  },
  {
    id: 'projects',
    name: 'Projects',
    description: 'Your tasks, notes and projects',
    href: '/projects',
  },
  {
    id: 'epam',
    name: 'EPAM',
    description: 'Your private work dashboard',
    href: '/boards/epam',
  },
  {
    id: 'training',
    name: 'Training',
    description: 'Workouts, exercises and records',
    href: '/training',
  },
];
/**
 * Modules whose cards never appear on a profile. EPAM is a private work dashboard; training is
 * private until its sharing phase (spec 020).
 */
export const UNSHAREABLE_MODULES: readonly ModuleId[] = ['epam', 'training'];
export function isShareableModule(id: ModuleId): boolean {
  return !UNSHAREABLE_MODULES.includes(id);
}
export const SETUP_STEPS = [
  'modules',
  'privacy',
  'home',
  'nutrition-profile-v2',
  'apple-health-v1',
  'ready',
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export interface PortalState {
  completedSetupSteps?: SetupStep[];
  cohort: UserCohort | 'developer';
  access: FeatureAccess;
  selectedModules: ModuleId[];
  moduleVisibility: Record<ModuleId, Audience>;
  widgetOrder: string[];
  setupStep: number;
  setupCompleted: boolean;
  setupDismissed: boolean;
}
export interface PortalPreferences {
  completedSetupSteps?: SetupStep[];
  selectedModules?: ModuleId[];
  moduleVisibility?: Partial<Record<ModuleId, Audience>>;
  widgetOrder?: string[];
  setupStep?: number;
  setupCompleted?: boolean;
  setupDismissed?: boolean;
}
export interface AccessUser {
  id: string;
  name: string;
  cohort: UserCohort | 'developer';
  overrides: Partial<FeatureAccess>;
}

/**
 * A group's concrete settings. `access` is what every account in the group gets unless it has
 * its own override; there is no "unset" state for a group (the admin owns every value).
 */
export interface CohortPolicy {
  cohort: UserCohort;
  access: FeatureAccess;
}

export const FEATURES: { id: FeatureId; name: string }[] = [
  ...MODULES,
  { id: 'social', name: 'Social connections' },
  { id: 'foodPosts', name: 'Wall and food posts' },
  { id: 'push', name: 'Push notifications' },
  { id: 'messages', name: 'Direct messages' },
  { id: 'postMedia', name: 'Photos and video in posts' },
  { id: 'forYou', name: 'For You feed' },
  { id: 'trainingLevels', name: 'Training levels' },
  { id: 'forYouRanking', name: 'For You personalised ranking' },
];
