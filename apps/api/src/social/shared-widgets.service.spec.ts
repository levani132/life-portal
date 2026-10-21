import { SharedWidgetsService } from './shared-widgets.service';
import { resolveFeatureAccess } from '@life-portal/shared-domain';
import type { Audience } from '@life-portal/shared-types';
function fixture(audience: Audience = 'friends') {
  const viewer = resolveFeatureAccess('internal');
  const owner = resolveFeatureAccess('internal');
  const access = { forUser: jest.fn().mockResolvedValue({ access: owner }) };
  const preferences = {
    selectedModules: ['nutrition'],
    widgetOrder: ['nutrition'],
    moduleVisibility: { nutrition: audience },
  };
  const settings = { get: jest.fn().mockResolvedValue(preferences) };
  const nutrition = {
    profile: jest.fn().mockResolvedValue({ shareDiary: true }),
    sharedStats: jest.fn().mockResolvedValue([]),
    sharedDiary: jest.fn().mockResolvedValue({ day: '2026-10-22', slots: [] }),
  };
  const service = new SharedWidgetsService(
    access as never,
    settings as never,
    nutrition as never,
    ...(Array(7).fill({}) as [never, never, never, never, never, never, never]),
  );
  return { viewer, owner, preferences, nutrition, service };
}
describe('daily diary audience and module checks', () => {
  it.each<[Audience, boolean, boolean]>([
    ['private', false, false],
    ['private', true, false],
    ['friends', false, false],
    ['friends', true, true],
    ['public', false, true],
  ])(
    'requires %s audience for friends=%s',
    async (audience, friends, allowed) => {
      const f = fixture(audience);
      const result = await f.service.diaryForViewer(
        'owner',
        f.viewer,
        friends,
        '2026-10-22',
        '2026-10-22',
      );
      expect(!!result).toBe(allowed);
      expect(f.nutrition.sharedDiary).toHaveBeenCalledTimes(allowed ? 1 : 0);
    },
  );
  it.each([
    'viewerFood',
    'ownerFood',
    'ownerSocial',
    'viewerSocial',
    'unselected',
  ])('fails closed for %s', async (reason) => {
    const f = fixture('public');
    if (reason === 'viewerFood') f.viewer.nutrition = false;
    if (reason === 'ownerFood') f.owner.nutrition = false;
    if (reason === 'ownerSocial') f.owner.social = false;
    if (reason === 'viewerSocial') f.viewer.social = false;
    if (reason === 'unselected') f.preferences.selectedModules = [];
    expect(
      await f.service.diaryForViewer(
        'owner',
        f.viewer,
        true,
        '2026-10-22',
        '2026-10-22',
      ),
    ).toBeNull();
    expect(f.nutrition.sharedDiary).not.toHaveBeenCalled();
  });
  it('keeps the Food widget visible when only diary sharing is enabled', async () => {
    const f = fixture();
    expect(
      await f.service.forViewer('owner', f.viewer, true, '2026-10-22'),
    ).toEqual([
      {
        module: 'nutrition',
        title: 'Food',
        audience: 'friends',
        stats: [],
        hasDiary: true,
      },
    ]);
  });
});
