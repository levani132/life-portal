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
    expect(MODULE_IDS.filter((id) => access[id])).toHaveLength(7);
    expect(
      Object.values(
        resolveFeatureAccess('developer', { nutrition: false }),
      ).every(Boolean),
    ).toBe(true);
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
