import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { ExerciseRankView, FeatureAccess, RankStandards } from '@life-portal/shared-types';
import { FakeModel } from '../training/fake-model.testing';
import { TournamentsService } from './tournaments.service';

const EX = new Types.ObjectId().toHexString();
const DEV = 'dev';

/** A rank view as `rankFor` returns it: ranked at `milestone`, or unranked with a reason. */
const ranked = (milestone: number): ExerciseRankView => ({
  exerciseId: EX,
  status: 'ranked',
  windowDays: 90,
  excluded: { implausible: 0, noBodyWeight: 0, machine: 0 },
  benchmark: { version: 'v1-draft-2', draft: true, method: 'e1rm', standards: 'men', tierStarts: [0, 1, 2, 3, 4, 5, 6, 7], basis: '' },
  current: { milestone, tier: 'Achiever', division: 'III', score: 1000 + milestone, progress: 0, basis: { setId: 's', sessionId: 'w', day: '2026-11-25', reps: 1 } },
});
const unranked = (reason: ExerciseRankView['reason']): ExerciseRankView => ({
  exerciseId: EX,
  status: 'unranked',
  reason,
  windowDays: 90,
  excluded: { implausible: 0, noBodyWeight: 0, machine: 0 },
});

function setup(options: { now?: string; access?: Partial<FeatureAccess> } = {}) {
  const entries = new FakeModel([['userId', 'exerciseId', 'season']]);
  const groups = new FakeModel([['season', 'exerciseId', 'category', 'index']]);
  const locks = new FakeModel([['season', 'exerciseId', 'category']]);
  const rankOf = new Map<string, ExerciseRankView>();
  const standards = new Map<string, RankStandards>();
  const profiles = new Set<string>();
  const blocked = new Map<string, string[]>();
  const rankCalls: unknown[][] = [];
  const reminders: { type: string; recipientId: string; targetId: string }[] = [];
  const access = {
    forUser: async () => ({ access: { tournaments: true, trainingRanks: true, training: true, social: true, ...options.access } }),
    requireDeveloper: (userId: string) => {
      if (userId !== DEV) throw new ForbiddenException('Developer access required.');
    },
  };
  const service = new TournamentsService(
    entries as never,
    groups as never,
    locks as never,
    {
      rankFor: async (...args: unknown[]) => {
        rankCalls.push(args);
        return { view: rankOf.get(args[0] as string) ?? unranked('no_valid_sets'), name: 'Bench press' };
      },
    } as never,
    { read: async (userId: string) => ({ rankStandards: standards.get(userId) }) } as never,
    {
      authors: async (ids: string[]) =>
        new Map(ids.filter((id) => profiles.has(id)).map((id) => [id, { userId: id, displayName: `Name ${id}`, username: id, avatarUrl: `https://signed/${id}` }])),
    } as never,
    { blockedUserIds: async (userId: string) => blocked.get(userId) ?? [] } as never,
    access as never,
    { register: () => undefined, remind: async (input: (typeof reminders)[number]) => void reminders.push(input) } as never,
    { disableSchedules: false } as never,
  );
  let now = new Date(options.now ?? '2026-11-25T12:00:00Z');
  service.now = () => now;
  const member = (id: string, category: RankStandards = 'men', milestone = 9) => {
    standards.set(id, category);
    profiles.add(id);
    rankOf.set(id, ranked(milestone));
  };
  const join = (id: string, category: RankStandards = 'men') =>
    service.join(id, { exerciseId: EX, season: '2026-12', category, consentVersion: 1 });
  return { service, entries, groups, locks, rankOf, standards, profiles, blocked, rankCalls, reminders, member, join, setNow: (iso: string) => (now = new Date(iso)) };
}

describe('TournamentsService (#12)', () => {
  describe('joining', () => {
    it('enters a ranked member with an explicit, matching category and consent', async () => {
      const t = setup();
      t.member('a');
      const entry = await t.join('a');
      expect(entry).toMatchObject({ status: 'entered', category: 'men', season: { id: '2026-12', phase: 'enrolling', locksAt: '2026-12-01T00:00:00.000Z' } });
      // Kept 12 months after the results are final (4 January 2027, 00:00 UTC).
      expect(t.entries.docs[0].expireAt).toEqual(new Date('2028-01-04T00:00:00.000Z'));
    });

    it('needs the feature, enrolment open and the current consent', async () => {
      await expect(setup({ access: { tournaments: false } }).join('a')).rejects.toBeInstanceOf(ForbiddenException);
      const early = setup({ now: '2026-11-19T23:59:59Z' });
      early.member('a');
      await expect(early.join('a')).rejects.toThrow('not open');
      const late = setup({ now: '2026-12-01T00:00:00Z' });
      late.member('a');
      await expect(late.join('a')).rejects.toThrow('not open');
      const t = setup();
      t.member('a');
      await expect(t.service.join('a', { exerciseId: EX, season: '2026-12', category: 'men', consentVersion: 0 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never derives the category from the private standards: it must be chosen and must match', async () => {
      const t = setup();
      t.member('a', 'women');
      await expect(t.join('a', 'men')).rejects.toThrow('other standards');
      t.standards.delete('a');
      await expect(t.join('a', 'women')).rejects.toThrow('Choose the standards');
      t.standards.set('a', 'women');
      await expect(t.join('a', 'women')).resolves.toMatchObject({ category: 'women' });
      expect(t.rankCalls.at(-1)?.[3]).toBe('women');
    });

    it('needs a social profile, a ranked exercise and a current rank — which can be earned before the lock', async () => {
      const t = setup();
      t.member('a');
      t.profiles.delete('a');
      await expect(t.join('a')).rejects.toThrow('profile');
      t.profiles.add('a');
      t.rankOf.set('a', unranked('no_benchmark'));
      await expect(t.join('a')).rejects.toThrow('no rank standards');
      t.rankOf.set('a', unranked('no_valid_sets'));
      await expect(t.join('a')).rejects.toThrow('current rank');
      // A valid set later in the enrolment window: now they can enter.
      t.rankOf.set('a', ranked(5));
      await expect(t.join('a')).resolves.toMatchObject({ status: 'entered' });
      await expect(t.join('a')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('the lock', () => {
    async function enrolled() {
      const t = setup();
      for (const [id, milestone] of [['m1', 9], ['m2', 9], ['m3', 10], ['m4', 15]] as const) t.member(id, 'men', milestone);
      t.member('w1', 'women', 9);
      t.member('w2', 'women', 9);
      t.member('lapsed', 'men', 9);
      for (const id of ['m1', 'm2', 'm3', 'm4', 'lapsed']) await t.join(id);
      for (const id of ['w1', 'w2']) await t.join(id, 'women');
      // By the lock, one member's rank has lapsed.
      t.rankOf.set('lapsed', unranked('no_valid_sets'));
      t.setNow('2026-12-01T00:30:00Z');
      return t;
    }

    it('does nothing before the lock instant', async () => {
      const t = setup();
      t.member('a');
      await t.join('a');
      t.setNow('2026-11-30T23:59:59Z');
      await t.service.ensureLocked('2026-12', EX, 'men');
      expect(t.groups.docs).toHaveLength(0);
    });

    it('groups each category separately from a rank snapshot, and never invents competitors', async () => {
      const t = await enrolled();
      await t.service.ensureLocked('2026-12', EX, 'men');
      await t.service.ensureLocked('2026-12', EX, 'women');
      expect(t.groups.docs.map((g) => [g['category'], g['memberIds']])).toEqual([['men', ['m1', 'm2', 'm3', 'm4']]]);
      const byUser = Object.fromEntries(t.entries.docs.map((e) => [e['userId'], e]));
      expect(byUser['m1']).toMatchObject({ outcome: 'grouped', lockedMilestone: 9, lockedScore: 1009, lockedVersion: 'v1-draft-2' });
      expect(byUser['w1']).toMatchObject({ outcome: 'no_tournament', lockedMilestone: 9 });
      expect(byUser['lapsed']).toMatchObject({ outcome: 'not_ranked' });
      expect(byUser['lapsed']['groupId']).toBeUndefined();
    });

    it('freezes the rank as it stood at the lock: the last day before, sets saved before the instant, the category’s standards', async () => {
      const t = await enrolled();
      t.rankCalls.length = 0;
      await t.service.ensureLocked('2026-12', EX, 'men');
      expect(t.rankCalls[0]).toEqual(['m1', EX, '2026-11-30', 'men', new Date('2026-12-01T00:00:00Z')]);
    });

    it('forms groups once, and a mid-season rank change never reshuffles them', async () => {
      const t = await enrolled();
      await t.service.ensureLocked('2026-12', EX, 'men');
      const first = JSON.stringify(t.groups.docs);
      t.rankOf.set('m1', ranked(20));
      await t.service.ensureLocked('2026-12', EX, 'men');
      await t.service.lockDue();
      expect(JSON.stringify(t.groups.docs)).toBe(first);
    });

    it('sends "group assigned" only to members who got a group', async () => {
      const t = await enrolled();
      await t.service.lockDue();
      expect(t.reminders.map((r) => [r.type, r.recipientId]).sort()).toEqual(
        ['m1', 'm2', 'm3', 'm4'].map((id) => ['tournamentGroupAssigned', id]),
      );
    });

    it('reports statuses on read, forming groups lazily', async () => {
      const t = await enrolled();
      const overview = await t.service.overview('w1');
      expect(overview.entries[0]).toMatchObject({ status: 'no_tournament', lockedRank: { tier: 'Achiever', division: 'III' } });
      expect((await t.service.overview('m1')).entries[0]).toMatchObject({ status: 'grouped' });
      expect(overview.enrollable).toBeUndefined();
    });
  });

  describe('the group view', () => {
    async function grouped() {
      const t = setup();
      for (const id of ['a', 'b', 'c', 'd']) {
        t.member(id);
        await t.join(id);
      }
      t.setNow('2026-12-02T00:00:00Z');
      await t.service.lockDue();
      const groupId = String(t.groups.docs[0]._id);
      return { ...t, groupId };
    }

    it('shows group members their public identity only — no score, load, body weight, standards or dates', async () => {
      const t = await grouped();
      const view = await t.service.group('a', t.groupId);
      expect(view).toMatchObject({ rankRange: 'Achiever III', category: 'men', standings: null });
      expect(view.members[0]).toMatchObject({ userId: 'a', self: true });
      expect(view.members.map((m) => m.displayName)).toEqual(['Name a', 'Name b', 'Name c', 'Name d']);
      for (const member of view.members) expect(Object.keys(member).sort()).toEqual(['avatarUrl', 'displayName', 'self', 'userId', 'username']);
    });

    it('is a 404 for anyone outside the group', async () => {
      const t = await grouped();
      await expect(t.service.group('stranger', t.groupId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(t.service.group('a', 'nonsense')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hides a blocked member’s identity, both ways', async () => {
      const t = await grouped();
      t.blocked.set('a', ['b']);
      const view = await t.service.group('a', t.groupId);
      expect(view.members).toContainEqual({ self: false });
      expect(view.members.map((m) => m.userId)).not.toContain('b');
    });

    it('withdrawal takes effect at once: off the group, entry gone, group closed to them', async () => {
      const t = await grouped();
      const entry = (await t.service.overview('b')).entries[0];
      await t.service.withdraw('b', entry.id);
      expect(t.entries.docs.map((e) => e['userId'])).not.toContain('b');
      expect((await t.service.group('a', t.groupId)).members.map((m) => m.userId)).toEqual(['a', 'c', 'd']);
      await expect(t.service.group('b', t.groupId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(t.service.withdraw('a', entry.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('voiding is developer-only; the member sees the reason, the group stops showing them', async () => {
      const t = await grouped();
      const entry = (await t.service.overview('c')).entries[0];
      await expect(t.service.voidEntry('a', entry.id, 'Impossible set')).rejects.toBeInstanceOf(ForbiddenException);
      await t.service.voidEntry(DEV, entry.id, 'Impossible set logged');
      expect((await t.service.overview('c')).entries[0]).toMatchObject({ status: 'voided', voidReason: 'Impossible set logged' });
      expect((await t.service.overview('c')).entries[0].groupId).toBeUndefined();
      expect((await t.service.group('a', t.groupId)).members.map((m) => m.userId)).toEqual(['a', 'b', 'd']);
      await expect(t.service.group('c', t.groupId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('the enrolment reminder', () => {
    it('goes out on the 20th, only to members who have entered before', async () => {
      const t = setup({ now: '2026-11-25T12:00:00Z' });
      t.member('a');
      await t.join('a');
      t.setNow('2026-12-20T00:10:00Z');
      expect(await t.service.remindEnrollmentOpen()).toBe(1);
      expect(t.reminders).toEqual([{ type: 'tournamentEnrollmentOpen', recipientId: 'a', targetId: '2027-01' }]);
      t.setNow('2026-12-21T00:10:00Z');
      expect(await t.service.remindEnrollmentOpen()).toBe(0);
    });
  });

  it('never sends a results reminder: scoring is not approved yet', async () => {
    const t = setup();
    t.member('a');
    await t.join('a');
    t.setNow('2027-01-05T00:00:00Z');
    await t.service.lockDue();
    await t.service.overview('a');
    expect(t.reminders.map((r) => r.type)).not.toContain('tournamentResultsReady');
  });
});
