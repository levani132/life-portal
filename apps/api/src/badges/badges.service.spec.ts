import { ForbiddenException } from '@nestjs/common';
import { resolveFeatureAccess } from '@life-portal/shared-domain';
import type { FeatureId } from '@life-portal/shared-types';
import { BadgesService } from './badges.service';

const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TODAY = '2026-11-12';
const day = (offset: number) =>
  new Date(Date.UTC(2026, 10, 12 + offset)).toISOString().slice(0, 10);

type Award = { userId: string; badgeId: string; tier: number; earnedOn: string };

function fixture(
  options: {
    off?: FeatureId[];
    foodDays?: number; // consecutive logged days ending yesterday
    postDays?: string[];
    friends?: (string | undefined)[];
    equipped?: string[];
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
  const selections = {
    findOne: jest.fn().mockImplementation(() =>
      lean(() => (options.equipped ? { userId: USER, equipped: options.equipped } : null)),
    ),
  };
  const users = {
    findById: jest.fn().mockImplementation(() =>
      lean(() => ({ createdAt: new Date('2026-07-01T10:00:00Z') })),
    ),
  };
  const off = Object.fromEntries((options.off ?? []).map((flag) => [flag, false]));
  const access = {
    forUser: jest.fn().mockImplementation(async () => ({
      access: resolveFeatureAccess('internal', off),
    })),
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
  const posts = { originalPostDays: jest.fn().mockResolvedValue(options.postDays ?? []) };
  const portal = { get: jest.fn().mockResolvedValue({ setupCompleted: true }) };
  const graph = { acceptedSince: jest.fn().mockResolvedValue(options.friends ?? []) };
  const service = new BadgesService(
    awards as never,
    selections as never,
    users as never,
    access as never,
    nutrition as never,
    posts as never,
    portal as never,
    graph as never,
  );
  return { service, store, nutrition, posts, graph, portal };
}

describe('BadgesService.evaluate', () => {
  it('awards each reached tier once, even under two concurrent evaluations', async () => {
    const { service, store } = fixture({ foodDays: 8, postDays: ['2026-08-05'] });
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
    const { service, store } = fixture({ foodDays: 8, postDays: ['2026-08-05'] });
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

describe('BadgesService.mine', () => {
  it('shows earned badges, progress for locked tiers, and marks new ones', async () => {
    const { service } = fixture({ foodDays: 8 });
    const mine = await service.mine(USER, TODAY);
    const streak = mine.badges.find((badge) => badge.badgeId === 'loggingStreak');
    expect(streak).toMatchObject({ tier: 7, isNew: true, progress: { current: 8, next: 30 } });
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
