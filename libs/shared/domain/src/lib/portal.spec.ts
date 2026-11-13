import {
  moduleForPath,
  privateModuleVisibility,
  resolveFeatureAccess,
  selectedAvailableModules,
} from './portal';
import { MODULE_IDS } from '@life-portal/shared-types';

describe('portal policy', () => {
  it('gives production only Food and defaults all modules to private', () => {
    expect(
      selectedAvailableModules(undefined, resolveFeatureAccess('production')),
    ).toEqual(['nutrition']);
    expect(
      Object.values(privateModuleVisibility()).every(
        (value) => value === 'private',
      ),
    ).toBe(true);
  });
  it('allows internal general modules but reserves EPAM for the developer', () => {
    const access = resolveFeatureAccess('internal', { epam: true });
    expect(access.epam).toBe(false);
    expect(MODULE_IDS.filter((id) => access[id])).toHaveLength(8);
    const developer = resolveFeatureAccess('developer', { nutrition: false });
    expect(
      Object.entries(developer).every(([id, on]) => on || id === 'forYouMetrics'),
    ).toBe(true);
  });
  it('keeps measurement off for every cohort and the developer until turned on (#11)', () => {
    for (const cohort of ['production', 'internal', 'developer'] as const) {
      expect(resolveFeatureAccess(cohort).forYouMetrics).toBe(false);
      expect(resolveFeatureAccess(cohort, { forYouMetrics: true }).forYouMetrics).toBe(true);
    }
  });
  it('releases training to internal and developer accounts only (spec 020)', () => {
    expect(resolveFeatureAccess('production').training).toBe(false);
    expect(resolveFeatureAccess('internal').training).toBe(true);
    expect(resolveFeatureAccess('developer').training).toBe(true);
    expect(resolveFeatureAccess('production', { training: true }).training).toBe(true);
    expect(moduleForPath('/training')).toBe('training');
  });
  it('applies explicit false overrides and never adds new flags to a saved selection', () => {
    const access = resolveFeatureAccess('production', {
      nutrition: false,
      money: true,
    });
    expect(selectedAvailableModules(['nutrition'], access)).toEqual([]);
    expect(
      selectedAvailableModules(['money', 'money', 'stocks'], access),
    ).toEqual(['money']);
    expect(selectedAvailableModules([], access)).toEqual([]);
  });
  it('maps nested module routes without matching unrelated paths', () => {
    expect(moduleForPath('/spending/tokens')).toBe('money');
    expect(moduleForPath('/boards/epam')).toBe('epam');
    expect(moduleForPath('/boards/soulart')).toBe('projects');
    expect(moduleForPath('/settings/privacy')).toBeUndefined();
  });
});
