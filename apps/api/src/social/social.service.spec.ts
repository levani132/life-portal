import { ConflictException, NotFoundException } from '@nestjs/common';
import { resolveFeatureAccess } from '@life-portal/shared-domain';
import { SocialService } from './social.module';

const VIEWER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TARGET = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TODAY = '2026-11-11';

type Row = {
  lowId: string;
  highId: string;
  state: 'none' | 'pending' | 'accepted';
  requestedBy?: string;
  blockedBy: string[];
  mutedBy: string[];
};
const pair = (overrides: Partial<Row> = {}): Row => ({
  lowId: VIEWER,
  highId: TARGET,
  state: 'accepted',
  blockedBy: [],
  mutedBy: [],
  ...overrides,
});
const profileOf = (userId: string) => ({
  userId,
  username: `u-${userId.slice(0, 4)}`,
  displayName: `Name ${userId.slice(0, 4)}`,
  bio: '',
  discoverable: true,
});

function fixture(
  options: {
    row?: Row | null;
    socialOff?: string[];
    blocked?: string[];
    searchRows?: ReturnType<typeof profileOf>[];
  } = {},
) {
  const off = new Set(options.socialOff ?? []);
  const lean = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });
  const profiles = {
    findOne: jest
      .fn()
      .mockImplementation(({ userId }: { userId: string }) =>
        lean(profileOf(userId)),
      ),
    find: jest.fn().mockReturnValue({
      sort: () => ({
        skip: () => ({ limit: () => lean(options.searchRows ?? []) }),
      }),
    }),
    updateOne: jest.fn(),
  };
  const graph = {
    between: jest.fn().mockResolvedValue(options.row ?? null),
    blockedUserIds: jest.fn().mockResolvedValue(options.blocked ?? []),
    isBlocked: jest.fn().mockResolvedValue(!!options.row?.blockedBy.length),
    act: jest.fn().mockResolvedValue(true),
  };
  const access = {
    forUser: jest.fn().mockImplementation(async (userId: string) => ({
      access: resolveFeatureAccess('internal', { social: !off.has(userId) }),
    })),
  };
  const shared = {
    forViewer: jest.fn().mockResolvedValue([]),
    diaryForViewer: jest.fn().mockResolvedValue({ day: TODAY, slots: [] }),
  };
  const notifications = { notify: jest.fn(), register: jest.fn() };
  const service = new SocialService(
    profiles as never,
    {} as never,
    graph as never,
    access as never,
    shared as never,
    notifications as never,
  );
  return { profiles, graph, access, shared, notifications, service };
}

describe('profile visibility', () => {
  it.each([
    ['the viewer blocked the target', [VIEWER]],
    ['the target blocked the viewer', [TARGET]],
  ])('hides the whole profile when %s', async (_, blockedBy) => {
    const f = fixture({ row: pair({ blockedBy }) });
    await expect(f.service.profile(VIEWER, TARGET, TODAY)).rejects.toThrow(
      NotFoundException,
    );
    expect(f.shared.forViewer).not.toHaveBeenCalled();
  });

  it('hides the profile of someone whose social access is off', async () => {
    const f = fixture({ row: pair(), socialOff: [TARGET] });
    await expect(f.service.profile(VIEWER, TARGET, TODAY)).rejects.toThrow(
      NotFoundException,
    );
    expect(f.shared.forViewer).not.toHaveBeenCalled();
  });

  it.each<[string, Row | null, boolean]>([
    ['a stranger', null, false],
    ['a pending request', pair({ state: 'pending', requestedBy: VIEWER }), false],
    ['a friend', pair(), true],
  ])('treats %s as friends=%s for shared widgets', async (_, row, friends) => {
    const f = fixture({ row });
    await f.service.profile(VIEWER, TARGET, TODAY);
    expect(f.shared.forViewer).toHaveBeenCalledWith(
      TARGET,
      expect.anything(),
      friends,
      TODAY,
    );
  });

  it('previews your own profile as a stranger sees it', async () => {
    const f = fixture();
    f.profiles.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(profileOf(VIEWER)),
    });
    await f.service.profile(VIEWER, VIEWER, TODAY, 'stranger');
    expect(f.shared.forViewer).toHaveBeenCalledWith(
      VIEWER,
      expect.anything(),
      false,
      TODAY,
    );
  });

  it('answers 404, not 500, for a malformed id', async () => {
    const f = fixture();
    await expect(f.service.profile(VIEWER, 'nope', TODAY)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('food diary visibility', () => {
  it('refuses a future day before any lookup', async () => {
    const f = fixture({ row: pair() });
    await expect(
      f.service.foodDiary(VIEWER, TARGET, TODAY, { day: '2026-11-12' } as never),
    ).rejects.toThrow(NotFoundException);
    expect(f.graph.between).not.toHaveBeenCalled();
    expect(f.shared.diaryForViewer).not.toHaveBeenCalled();
  });

  it('hides the diary across a block in either direction', async () => {
    for (const blockedBy of [[VIEWER], [TARGET]]) {
      const f = fixture({ row: pair({ blockedBy }) });
      await expect(
        f.service.foodDiary(VIEWER, TARGET, TODAY, {} as never),
      ).rejects.toThrow(NotFoundException);
      expect(f.shared.diaryForViewer).not.toHaveBeenCalled();
    }
  });

  it('passes friends=false for a stranger and 404s when sharing says no', async () => {
    const f = fixture({ row: null });
    f.shared.diaryForViewer.mockResolvedValue(null);
    await expect(
      f.service.foodDiary(VIEWER, TARGET, TODAY, {} as never),
    ).rejects.toThrow(NotFoundException);
    expect(f.shared.diaryForViewer).toHaveBeenCalledWith(
      TARGET,
      expect.anything(),
      false,
      TODAY,
      TODAY,
    );
  });
});

describe('people search', () => {
  it('excludes yourself and blocked people in the query, and drops social-off accounts', async () => {
    const other = 'cccccccccccccccccccccccc';
    const f = fixture({
      blocked: [TARGET],
      socialOff: [other],
      searchRows: [profileOf(other), profileOf('dddddddddddddddddddddddd')],
    });
    const page = await f.service.search(VIEWER, { q: 'na', skip: 0 } as never);
    const filter = f.profiles.find.mock.calls[0][0];
    expect(filter.discoverable).toBe(true);
    expect(filter.userId.$nin).toEqual([VIEWER, TARGET]);
    expect(page.people.map((p) => p.userId)).toEqual([
      'dddddddddddddddddddddddd',
    ]);
  });

  it('escapes the query so it cannot act as a pattern', async () => {
    const f = fixture();
    await f.service.search(VIEWER, { q: '.*', skip: 0 } as never);
    const filter = f.profiles.find.mock.calls[0][0];
    expect(filter.$or[0].displayName.source).toBe('\\.\\*');
  });
});

describe('connection actions', () => {
  it('refuses to act on yourself', async () => {
    const f = fixture();
    await expect(
      f.service.act(VIEWER, VIEWER, { action: 'request' } as never),
    ).rejects.toThrow(ConflictException);
    expect(f.graph.act).not.toHaveBeenCalled();
  });

  it('cannot send a request across a block, but can still block or unblock', async () => {
    const f = fixture({ row: pair({ state: 'none', blockedBy: [TARGET] }) });
    await expect(
      f.service.act(VIEWER, TARGET, { action: 'request' } as never),
    ).rejects.toThrow(NotFoundException);
    expect(f.graph.act).not.toHaveBeenCalled();
    await f.service.act(VIEWER, TARGET, { action: 'block' } as never);
    await f.service.act(VIEWER, TARGET, { action: 'unblock' } as never);
    expect(f.graph.act).toHaveBeenCalledTimes(2);
  });

  it('can unblock someone whose social access is now off', async () => {
    const f = fixture({ socialOff: [TARGET] });
    await expect(
      f.service.act(VIEWER, TARGET, { action: 'request' } as never),
    ).rejects.toThrow(NotFoundException);
    await expect(
      f.service.act(VIEWER, TARGET, { action: 'unblock' } as never),
    ).resolves.toEqual({ success: true });
  });
});
