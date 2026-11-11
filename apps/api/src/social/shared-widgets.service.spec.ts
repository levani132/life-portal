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

describe('money widgets on a profile', () => {
  function moneyFixture(visibility: Partial<Record<string, Audience>>) {
    const access = {
      forUser: jest
        .fn()
        .mockResolvedValue({ access: resolveFeatureAccess('developer') }),
    };
    const settings = {
      get: jest.fn().mockResolvedValue({
        selectedModules: ['money', 'loans', 'epam', 'projects'],
        widgetOrder: [],
        moduleVisibility: visibility,
      }),
    };
    const cashflow = {
      summary: jest.fn().mockResolvedValue({
        currentBalanceCents: 123_45,
        freeTodayCents: 50_00,
        currency: 'GEL',
      }),
    };
    const loans = {
      summary: jest.fn().mockResolvedValue({
        totalRemainingCents: 1_000_00,
        totalPaidCents: 0,
        activeCount: 1,
        currency: 'GEL',
      }),
    };
    const boards = {
      summaries: jest.fn().mockResolvedValue([
        { key: 'epam', openTaskCount: 9, overdueTaskCount: 9 },
        { key: 'side', openTaskCount: 1, overdueTaskCount: 0 },
      ]),
    };
    const service = new SharedWidgetsService(
      access as never,
      settings as never,
      {} as never,
      cashflow as never,
      {} as never,
      loans as never,
      {} as never,
      {} as never,
      boards as never,
      {} as never,
    );
    const viewer = resolveFeatureAccess('internal');
    return { service, viewer, cashflow, loans, boards };
  }

  it('never computes a private money summary, even for a friend', async () => {
    const f = moneyFixture({ money: 'private', loans: 'private' });
    expect(await f.service.forViewer('owner', f.viewer, true, '2026-11-11')).toEqual([]);
    expect(f.cashflow.summary).not.toHaveBeenCalled();
    expect(f.loans.summary).not.toHaveBeenCalled();
  });

  it('shows friends-only money to friends and nothing to strangers', async () => {
    const f = moneyFixture({ money: 'friends', loans: 'public' });
    const stranger = await f.service.forViewer('owner', f.viewer, false, '2026-11-11');
    expect(stranger.map((w) => w.module)).toEqual(['loans']);
    expect(f.cashflow.summary).not.toHaveBeenCalled();
    const friend = await f.service.forViewer('owner', f.viewer, true, '2026-11-11');
    expect(friend.map((w) => w.module).sort()).toEqual(['loans', 'money']);
  });

  it('never shares the EPAM board, even when marked public', async () => {
    const f = moneyFixture({ epam: 'public', projects: 'public' });
    const widgets = await f.service.forViewer('owner', f.viewer, true, '2026-11-11');
    expect(widgets.map((w) => w.module)).toEqual(['projects']);
    expect(widgets[0].stats.find((s) => s.label === 'Open tasks')?.value).toBe('1');
  });

  it('shows nothing to a viewer without social access', async () => {
    const f = moneyFixture({ money: 'public' });
    f.viewer.social = false;
    expect(await f.service.forViewer('owner', f.viewer, true, '2026-11-11')).toEqual([]);
    expect(f.cashflow.summary).not.toHaveBeenCalled();
  });
});
