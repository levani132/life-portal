import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveFeatureAccess } from '@life-portal/shared-domain';
import type { FeatureId } from '@life-portal/shared-types';
import { BadgesService } from './badges.service';

const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TODAY = '2026-11-12';
const day = (offset: number) =>
  new Date(Date.UTC(2026, 10, 12 + offset)).toISOString().slice(0, 10);

type Award = {
  userId: string;
  badgeId: string;
  tier: number;
  earnedOn: string;
};

function fixture(
  options: {
    off?: FeatureId[];
    foodDays?: number; // consecutive logged days ending yesterday
    postDays?: string[];
    friends?: (string | undefined)[];
    equipped?: string[];
    /** Flags off for the other person (OTHER) only. */
    otherOff?: FeatureId[];
    blocked?: boolean;
    otherMissing?: boolean;
    /** Days of finished workouts. */
    workouts?: string[];
  } = {},
) {
  const store: Award[] = [];
  const lean = <T>(value: () => T) => ({
    select: () => ({ lean: jest.fn().mockImplementation(async () => value()) }),
    lean: jest.fn().mockImplementation(async () => value()),
  });
  const awards = {
    find: jest.fn().mockImplementation(({ userId }: { userId: string }) =>
      lean(() => store.filter((row) => row.userId === userId).map((row) => ({ ...row }))),
    ),
    // Behaves like the unique index: the second insert of a key is a no-op.
    distinct: jest.fn().mockImplementation(
      async (_: string, filter: { userId: string; badgeId: { $in: string[] } }) =>
        store
          .filter((row) => row.userId === filter.userId && filter.badgeId.$in.includes(row.badgeId))
          .map((row) => row.badgeId),
    ),
    updateOne: jest.fn().mockImplementation(
      async (
        filter: { userId: string; badgeId: string; tier: number },
        update: { $setOnInsert: { earnedOn: string } },
      ) => {
        const found = store.some(
          (row) =>
            row.userId === filter.userId &&
            row.badgeId === filter.badgeId &&
            row.tier === filter.tier,
        );
        if (found) return { upsertedCount: 0 };
        store.push({ ...filter, earnedOn: update.$setOnInsert.earnedOn });
        return { upsertedCount: 1 };
      },
    ),
  };
  let equipped = options.equipped;
  const selections = {
    findOne: jest.fn().mockImplementation(() =>
      lean(() => (equipped ? { userId: USER, equipped } : null)),
    ),
    updateOne: jest.fn().mockImplementation(async (_: unknown, update: { $set: { equipped: string[] } }) => {
      equipped = update.$set.equipped;
    }),
  };
  const users = {
    findById: jest.fn().mockImplementation(() =>
      lean(() => ({ createdAt: new Date('2026-07-01T10:00:00Z') })),
    ),
  };
  const off = Object.fromEntries((options.off ?? []).map((flag) => [flag, false]));
  const otherOff = Object.fromEntries((options.otherOff ?? []).map((flag) => [flag, false]));
  const access = {
    forUser: jest.fn().mockImplementation(async (userId: string) => {
      if (userId === OTHER && options.otherMissing) throw new UnauthorizedException();
      return {
        access: resolveFeatureAccess('internal', userId === OTHER ? otherOff : off),
      };
    }),
    require: jest.fn().mockImplementation(async (_: string, flag: FeatureId) => {
      if (options.off?.includes(flag)) throw new ForbiddenException();
    }),
  };
  const nutrition = {
    badgeInputs: jest.fn().mockImplementation(async () => ({
      days: Array.from({ length: options.foodDays ?? 0 }, (_, i) => ({
        day: day(i - (options.foodDays ?? 0)),
        eatenKcal: 2000,
        targetKcal: 2000,
      })),
      cheatDays: [],
    })),
  };
  const posts = {
    originalPostDays: jest.fn().mockResolvedValue(options.postDays ?? []),
  };
  const portal = { get: jest.fn().mockResolvedValue({ setupCompleted: true }) };
  const graph = {
    acceptedSince: jest.fn().mockResolvedValue(options.friends ?? []),
    isBlocked: jest.fn().mockResolvedValue(!!options.blocked),
  };
  const sessions = {
    finishedDays: jest.fn().mockResolvedValue(options.workouts ?? []),
  };
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    register: jest.fn(),
    registerActivitySource: jest.fn(),
  };
  const service = new BadgesService(
    awards as never,
    selections as never,
    users as never,
    access as never,
    nutrition as never,
    posts as never,
    portal as never,
    graph as never,
    sessions as never,
    notifications as never,
  );
  return {
    service,
    store,
    nutrition,
    posts,
    graph,
    portal,
    access,
    sessions,
    notifications,
  };
}

describe('BadgesService.evaluate', () => {
  it('awards each reached tier once, even under two concurrent evaluations', async () => {
    const { service, store } = fixture({
      foodDays: 8,
      postDays: ['2026-08-05'],
    });
    const [a, b] = await Promise.all([
      service.evaluate(USER, TODAY),
      service.evaluate(USER, TODAY),
    ]);
    const ids = store.map((row) => `${row.badgeId}:${row.tier}`).sort();
    expect(ids).toEqual([
      'earlyMember:1',
      'firstPost:1',
      'loggingStreak:7',
      'onTargetStreak:7',
      'setup:1',
    ]);
    expect(a.created.length + b.created.length).toBe(store.length);
  });

  it('dates awards from history', async () => {
    const { service, store } = fixture({
      foodDays: 8,
      postDays: ['2026-08-05'],
    });
    await service.evaluate(USER, TODAY);
    expect(store.find((row) => row.badgeId === 'firstPost')?.earnedOn).toBe('2026-08-05');
    expect(store.find((row) => row.badgeId === 'loggingStreak')?.earnedOn).toBe(day(-2));
    expect(store.find((row) => row.badgeId === 'earlyMember')?.earnedOn).toBe('2026-07-01');
  });

  it('keeps awards when the history that earned them is gone', async () => {
    const first = fixture({ foodDays: 8, friends: ['2026-09-01'] });
    await first.service.evaluate(USER, TODAY);
    first.nutrition.badgeInputs.mockResolvedValue({ days: [], cheatDays: [] });
    first.graph.acceptedSince.mockResolvedValue([]);
    const mine = await first.service.mine(USER, TODAY);
    const view = (id: string) => mine.badges.find((badge) => badge.badgeId === id);
    expect(view('loggingStreak')?.tier).toBe(7);
    expect(view('firstFriend')?.tier).toBe(1);
  });

  it('does not load a family whose every tier is already earned', async () => {
    const { service, posts, portal } = fixture({ postDays: ['2026-08-05'] });
    await service.evaluate(USER, TODAY);
    posts.originalPostDays.mockClear();
    portal.get.mockClear();
    await service.evaluate(USER, TODAY);
    expect(posts.originalPostDays).not.toHaveBeenCalled();
    expect(portal.get).not.toHaveBeenCalled();
  });
});

describe('BadgesService.evaluate: training', () => {
  it('awards training badges from finished workouts only', async () => {
    const { service, store, sessions } = fixture({ workouts: ['2026-11-03'] });
    await service.evaluate(USER, TODAY);
    expect(sessions.finishedDays).toHaveBeenCalledWith(USER);
    expect(store.find((row) => row.badgeId === 'firstWorkout')?.earnedOn).toBe('2026-11-03');
    expect(store.some((row) => row.badgeId === 'workouts')).toBe(false);
  });
});

describe('BadgesService: earned notification', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('sends one notification per evaluation, with the count', async () => {
    const { service, notifications } = fixture({
      foodDays: 8,
      postDays: ['2026-08-05'],
    });
    await service.evaluate(USER, TODAY);
    await flush();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({
      type: 'badgeEarned',
      recipientId: USER,
      actorId: USER,
      count: 5,
    });
  });

  it('sends nothing when nothing new was earned', async () => {
    const { service, notifications } = fixture({ postDays: ['2026-08-05'] });
    await service.evaluate(USER, TODAY);
    await flush();
    notifications.notify.mockClear();
    await service.evaluate(USER, TODAY);
    await flush();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('does not announce a badge whose feature is off', async () => {
    const { service, notifications } = fixture({
      foodDays: 8,
      off: ['nutrition'],
    });
    await service.evaluate(USER, TODAY);
    await flush();
    expect(notifications.notify.mock.calls[0][0].count).toBe(2); // setup and earlyMember; the food awards stay silent
  });

  it('names the badge in Activity and links to it', async () => {
    const { service } = fixture();
    const find = jest.fn().mockReturnValue({
      sort: () => ({
        limit: () => ({
          select: () => ({
            lean: async () => [
              {
                badgeId: 'loggingStreak',
                tier: 7,
                createdAt: new Date('2026-11-10T08:00:00Z'),
              },
              {
                badgeId: 'retired',
                tier: 1,
                createdAt: new Date('2026-11-09T08:00:00Z'),
              },
            ],
          }),
        }),
      }),
    });
    (service as unknown as { awards: { find: unknown } }).awards.find = find;
    const rows = await service.activity(USER, new Date('2026-10-01'), undefined, 20);
    expect(rows).toEqual([
      expect.objectContaining({
        type: 'badgeEarned',
        actorId: USER,
        badgeId: 'loggingStreak',
        badgeTier: 7,
        url: '/profile?badge=loggingStreak',
      }),
    ]);
  });
});

describe('BadgesService.mine', () => {
  it('shows earned badges, progress for locked tiers, and marks new ones', async () => {
    const { service } = fixture({ foodDays: 8 });
    const mine = await service.mine(USER, TODAY);
    const streak = mine.badges.find((badge) => badge.badgeId === 'loggingStreak');
    expect(streak).toMatchObject({
      tier: 7,
      isNew: true,
      progress: { current: 8, next: 30 },
    });
    const again = await service.mine(USER, TODAY);
    expect(again.badges.find((badge) => badge.badgeId === 'loggingStreak')?.isNew).toBeUndefined();
  });

  it('hides badges of a feature the person cannot access, without deleting them', async () => {
    const { service, store } = fixture({ foodDays: 8, off: ['nutrition'] });
    const mine = await service.mine(USER, TODAY);
    expect(mine.badges.some((badge) => badge.badgeId === 'loggingStreak')).toBe(false);
    expect(store.some((row) => row.badgeId === 'loggingStreak')).toBe(true);
  });

  it('never lists an unearned or hidden badge as equipped', async () => {
    const { service } = fixture({ equipped: ['firstPost', 'setup', 'loggingStreak'], off: ['nutrition'] });
    const mine = await service.mine(USER, TODAY);
    expect(mine.equipped).toEqual(['setup']);
  });

  it('needs social', async () => {
    const { service } = fixture({ off: ['social'] });
    await expect(service.mine(USER, TODAY)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('BadgesService.check', () => {
  it('reports only badges this call created', async () => {
    const { service } = fixture({ postDays: ['2026-08-05'] });
    expect((await service.check(USER, TODAY)).newBadgeIds.sort()).toEqual(
      ['earlyMember', 'firstPost', 'setup'].sort(),
    );
    expect((await service.check(USER, TODAY)).newBadgeIds).toEqual([]);
  });
});

describe('BadgesService.equip', () => {
  it('saves earned badges in the order given', async () => {
    const { service } = fixture({ foodDays: 8 });
    await service.evaluate(USER, TODAY);
    expect(await service.equip(USER, ['loggingStreak', 'earlyMember'])).toEqual({
      equipped: ['loggingStreak', 'earlyMember'],
    });
    expect((await service.mine(USER, TODAY)).equipped).toEqual(['loggingStreak', 'earlyMember']);
  });

  it('refuses a badge that is not earned', async () => {
    const { service } = fixture();
    await service.evaluate(USER, TODAY);
    await expect(service.equip(USER, ['earlyMember', 'firstPost'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses an earned badge whose feature is off', async () => {
    const { service } = fixture({ foodDays: 8, off: ['nutrition'] });
    await service.evaluate(USER, TODAY);
    await expect(service.equip(USER, ['loggingStreak'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('clears with an empty list', async () => {
    const { service } = fixture({ equipped: ['earlyMember'] });
    expect(await service.equip(USER, [])).toEqual({ equipped: [] });
  });
});

describe('BadgesService.forPerson', () => {
  /** USER owns the badges; OTHER looks at them. The fixture's store is shared by both ids. */
  async function viewed(options: Parameters<typeof fixture>[0] = {}) {
    const fx = fixture({ foodDays: 31, ...options });
    await fx.service.evaluate(USER, TODAY);
    await fx.service.equip(USER, ['loggingStreak', 'earlyMember']);
    return fx;
  }

  it('shows only equipped badges, each at its highest tier, with no progress', async () => {
    const { service } = await viewed();
    const result = await service.forPerson(OTHER, USER);
    expect(result).toEqual({
      equipped: [
        { badgeId: 'loggingStreak', tier: 30, earnedOn: expect.any(String) },
        { badgeId: 'earlyMember', tier: 1, earnedOn: '2026-07-01' },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/progress|onTargetStreak|current/);
  });

  it('is a 404 when either has blocked the other', async () => {
    const { service } = await viewed({ blocked: true });
    await expect(service.forPerson(OTHER, USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is a 404 for an unknown person or one without social', async () => {
    const { service } = await viewed({ otherMissing: true });
    await expect(service.forPerson(USER, OTHER)).rejects.toBeInstanceOf(NotFoundException);
    const off = await viewed({ otherOff: ['social'] });
    await expect(off.service.forPerson(USER, OTHER)).rejects.toBeInstanceOf(NotFoundException);
    await expect(off.service.forPerson(USER, 'not-an-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('drops equipped badges of a feature the owner has lost', async () => {
    const fx = await viewed();
    fx.access.forUser.mockImplementation(async () => ({
      access: resolveFeatureAccess('internal', { nutrition: false }),
    }));
    expect((await fx.service.forPerson(OTHER, USER)).equipped.map((b) => b.badgeId)).toEqual([
      'earlyMember',
    ]);
  });

  it('needs social for the viewer', async () => {
    const { service } = fixture({ off: ['social'] });
    await expect(service.forPerson(USER, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
