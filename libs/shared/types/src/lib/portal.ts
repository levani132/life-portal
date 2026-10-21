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
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export const COHORTS = ['production', 'internal'] as const;
export type UserCohort = (typeof COHORTS)[number];
export const FEATURE_IDS = [...MODULE_IDS, 'social', 'foodPosts'] as const;
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
];
export interface PortalState {
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

export interface CohortPolicy {
  cohort: UserCohort;
  overrides: Partial<FeatureAccess>;
}

export const FEATURES: { id: FeatureId; name: string }[] = [
  ...MODULES,
  { id: 'social', name: 'Social connections' },
  { id: 'foodPosts', name: 'Wall and food posts' },
];
