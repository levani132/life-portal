import {
  MODULE_IDS,
  FEATURE_IDS,
  type Audience,
  type FeatureAccess,
  type ModuleId,
  type FeatureId,
  type UserCohort,
} from '@life-portal/shared-types';

export function resolveFeatureAccess(
  cohort: UserCohort | 'developer',
  overrides: Partial<FeatureAccess> = {},
): FeatureAccess {
  return Object.fromEntries(
    FEATURE_IDS.map((id) => [
      id,
      cohort === 'developer' ||
        (id !== 'epam' &&
          (overrides[id] ?? (cohort === 'internal' || id === 'nutrition'))),
    ]),
  ) as FeatureAccess;
}
export function privateModuleVisibility(): Record<ModuleId, Audience> {
  return Object.fromEntries(MODULE_IDS.map((id) => [id, 'private'])) as Record<
    ModuleId,
    Audience
  >;
}
export function selectedAvailableModules(
  selected: ModuleId[] | undefined,
  access: FeatureAccess,
): ModuleId[] {
  return [...new Set(selected ?? MODULE_IDS.filter((id) => access[id]))].filter(
    (id) => access[id],
  );
}
export function moduleForPath(path: string): FeatureId | undefined {
  if (path === '/settings/profile') return 'social';
  if (path === '/settings/notifications') return 'push';
  const root = path.split('/').filter(Boolean)[0];
  return (
    {
      wall: 'foodPosts',
      posts: 'foodPosts',
      activity: 'push',
      search: 'social',
      friends: 'social',
      people: 'social',
      profile: 'social',
      nutrition: 'nutrition',
      cashflow: 'money',
      spending: 'money',
      stocks: 'stocks',
      loans: 'loans',
      items: 'items',
      personal: 'personal',
      projects: 'projects',
      boards: path.split('/')[2] === 'epam' ? 'epam' : 'projects',
    } as Record<string, FeatureId>
  )[root];
}

/** Legacy completed flags represent only the original four steps. */
export function migratedSetupSteps(settings: {
  completedSetupSteps?: import('@life-portal/shared-types').SetupStep[];
  setupCompleted?: boolean;
  setupStep?: number;
}): import('@life-portal/shared-types').SetupStep[] {
  if (settings.completedSetupSteps) return settings.completedSetupSteps;
  const old = ['modules', 'privacy', 'home', 'ready'] as const;
  return settings.setupCompleted
    ? [...old]
    : old.slice(0, settings.setupStep ?? 0);
}
