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
  const root = path.split('/').filter(Boolean)[0];
  return (
    {
      wall: 'foodPosts',
      posts: 'foodPosts',
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
