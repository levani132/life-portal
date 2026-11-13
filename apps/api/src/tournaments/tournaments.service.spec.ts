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
  /** Each member's sets as strength scores, with the day they are dated and when they were saved. */
  const history = new Map<string, { day: string; score: number; savedAt: Date }[]>();
  const strengthCalls: unknown[][] = [];
  const standardsChanged = { value: false };
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
      strengthBest: async (
        userId: string,
        _exerciseId: string,
        _standards: RankStandards,
        window: { from: string; to: string },
        savedBefore: Date,
        locked: string | { version: string } | undefined,
        today: string,
      ) => {
        strengthCalls.push([userId, window, savedBefore, locked, today]);
        // A frozen copy scores as it was copied; a bare version name follows `standardsChanged`.
        const frozen = typeof locked === 'object';
        const version = frozen ? locked.version : locked;
        const changed = frozen ? false : standardsChanged.value;
        const standard = frozen ? locked : { version, method: 'e1rm', measure: 'weight_reps', starts: { men: [0, 1], women: [0, 1] } };
        const sets = (history.get(userId) ?? []).filter((set) => set.day >= window.from && set.day <= window.to && set.savedAt < savedBefore);
        if (!sets.length) return { standard, changed };
        const best = sets.reduce((a, b) => (b.score > a.score ? b : a));
        return { best: { score: best.score, basis: { setId: 's', sessionId: 'w', day: best.day, reps: 1 } }, version, standard, changed };
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
    // A baseline-window set: strength 1000 on 20 November.
    history.set(id, [{ day: '2026-11-20', score: 1000, savedAt: new Date('2026-11-20T10:00:00Z') }]);
  };
  const lift = (id: string, day: string, score: number, savedAt = `${day}T18:00:00Z`) =>
    history.get(id)?.push({ day, score, savedAt: new Date(savedAt) });
  const join = (id: string, category: RankStandards = 'men') =>
    service.join(id, { exerciseId: EX, season: '2026-12', category, consentVersion: 1 });
  return {
    service,
    entries,
    groups,
    locks,
    rankOf,
    standards,
    profiles,
    blocked,
    rankCalls,
    reminders,
    history,
    strengthCalls,
    standardsChanged,
    member,
    lift,
    join,
    setNow: (iso: string) => (now = new Date(iso)),
  };
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
      expect(byUser['m1']).toMatchObject({ outcome: 'grouped', lockedMilestone: 9, lockedScore: 1009, lockedVersion: 'v1-draft-2', lockedBaseline: 1000 });
      expect(byUser['w1']).toMatchObject({ outcome: 'no_tournament', lockedMilestone: 9 });
      expect(byUser['lapsed']).toMatchObject({ outcome: 'not_ranked' });
      expect(byUser['lapsed']['groupId']).toBeUndefined();
    });

    it('freezes the rank as it stood at the lock: the last day before, sets saved before the instant, the category’s standards', async () => {
      const t = await enrolled();
      t.rankCalls.length = 0;
      await t.service.ensureLocked('2026-12', EX, 'men');
      expect(t.rankCalls[0]).toEqual(['m1', EX, '2026-11-30', 'men', new Date('2026-12-01T00:00:00Z')]);
      // The baseline: the 90 days before, sets saved before the lock, under the rank's version.
      expect(t.strengthCalls[0]).toEqual(['m1', { from: '2026-09-02', to: '2026-11-30' }, new Date('2026-12-01T00:00:00Z'), 'v1-draft-2', '2026-11-30']);
    });

    it('a set saved after the lock never enters the baseline, even when dated before it', async () => {
      const t = await enrolled();
      t.lift('m1', '2026-11-28', 1400, '2026-12-01T00:00:01Z');
      await t.service.ensureLocked('2026-12', EX, 'men');
      expect(t.entries.docs.find((e) => e['userId'] === 'm1')).toMatchObject({ lockedBaseline: 1000 });
    });

    it('without a baseline there is no entry to score: not ranked, nothing invented', async () => {
      const t = await enrolled();
      t.history.set('m4', []);
      await t.service.ensureLocked('2026-12', EX, 'men');
      expect(t.entries.docs.find((e) => e['userId'] === 'm4')).toMatchObject({ outcome: 'not_ranked' });
      expect(t.entries.docs.find((e) => e['userId'] === 'm4')?.['lockedBaseline']).toBeUndefined();
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

    it('shows others identity, place and score only — no load, body weight, baseline, improvement or dates', async () => {
      const t = await grouped();
      for (const [id, score] of [['a', 1100], ['b', 1300], ['c', 1000], ['d', 1050]] as const) t.lift(id, '2026-12-01', score);
      const view = await t.service.group('a', t.groupId);
      expect(view).toMatchObject({ rankRange: 'Achiever III', category: 'men', method: 'e1rm', final: false });
      for (const row of view.standings) expect(Object.keys(row).sort()).toEqual(['avatarUrl', 'displayName', 'place', 'score', 'self', 'userId', 'username']);
      // Only the viewer's own breakdown, and it explains the score.
      expect(view.own).toEqual({ score: 1137, strengthScore: 1100, baseline: 1000, improvementBp: 1000, bonusBp: 333, day: '2026-12-01' });
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
      expect(view.standings).toContainEqual({ self: false });
      expect(view.standings.map((m) => m.userId)).not.toContain('b');
    });

    it('withdrawal takes effect at once: off the group, entry gone, group closed to them', async () => {
      const t = await grouped();
      const entry = (await t.service.overview('b')).entries[0];
      await t.service.withdraw('b', entry.id);
      expect(t.entries.docs.map((e) => e['userId'])).not.toContain('b');
      expect((await t.service.group('a', t.groupId)).standings.map((m) => m.userId)).toEqual(['a', 'c', 'd']);
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
      expect((await t.service.group('a', t.groupId)).standings.map((m) => m.userId)).toEqual(['a', 'b', 'd']);
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

  describe('scoring (owner formula)', () => {
    async function season() {
      const t = setup();
      for (const id of ['a', 'b', 'c', 'd']) {
        t.member(id);
        await t.join(id);
      }
      t.setNow('2026-12-15T12:00:00Z');
      await t.service.lockDue();
      const groupId = String(t.groups.docs[0]._id);
      const places = async (viewer = 'a') => (await t.service.group(viewer, groupId)).standings.map((row) => [row.userId, row.place, row.score]);
      return { ...t, groupId, places };
    }

    it('ranks by tournament score: absolute strength first, a capped improvement bonus, no place without a valid set', async () => {
      const t = await season();
      t.lift('a', '2026-12-03', 1100); // +10% → +3.33%
      t.lift('b', '2026-12-04', 1300); // +30% → capped +5%
      t.lift('c', '2026-12-05', 950); // weaker: no penalty, no bonus
      expect(await t.places()).toEqual([
        ['b', 1, 1365],
        ['a', 2, 1137],
        ['c', 3, 950],
        ['d', undefined, undefined],
      ]);
    });

    it('shares the place on an exact tie, with no tie-break by volume or workouts', async () => {
      const t = await season();
      t.lift('a', '2026-12-03', 1100);
      t.lift('c', '2026-12-03', 1100);
      for (let day = 4; day < 20; day++) t.lift('c', `2026-12-${String(day).padStart(2, '0')}`, 1000);
      expect(await t.places()).toEqual([
        ['a', 1, 1137],
        ['c', 1, 1137],
        ['b', undefined, undefined],
        ['d', undefined, undefined],
      ]);
    });

    it('cannot be gamed: backdated sets, post-lock edits of history and late saves never count', async () => {
      const t = await season();
      // Saved during the season but dated before it: not a season set, and the baseline is frozen.
      t.lift('a', '2026-11-25', 2000, '2026-12-10T00:00:00Z');
      // Pre-lock history deleted after the lock: the frozen baseline stands.
      t.history.set('b', []);
      t.lift('b', '2026-12-02', 1000);
      // Dated in the season but saved after grace ended.
      t.lift('c', '2026-12-31', 1500, '2027-01-04T00:00:00Z');
      t.lift('c', '2026-12-30', 1000);
      const view = await t.service.group('b', t.groupId);
      expect(view.own).toMatchObject({ baseline: 1000, strengthScore: 1000, bonusBp: 0, score: 1000 });
      expect(view.standings.find((row) => row.userId === 'a')?.score).toBeUndefined();
      expect(view.standings.find((row) => row.userId === 'c')?.score).toBe(1000);
      expect(t.strengthCalls.at(-1)).toEqual(expect.arrayContaining([{ from: '2026-12-01', to: '2026-12-31' }, new Date('2027-01-04T00:00:00Z'), expect.objectContaining({ version: 'v1-draft-2' })]));
    });

    it('scores the whole season under the one standard copied at the lock, whatever is published later (#5)', async () => {
      const t = await season();
      const entry = t.entries.docs.find((doc) => doc['userId'] === 'a') as Record<string, unknown>;
      expect(entry['lockedStandard']).toMatchObject({ version: 'v1-draft-2', method: 'e1rm', measure: 'weight_reps' });
      expect(entry['lockedVersion']).toBe('v1-draft-2');
      // Every entrant of the lock holds the same version.
      expect(new Set(t.entries.docs.filter((doc) => doc['lockedStandard']).map((doc) => (doc['lockedStandard'] as { version: string }).version))).toEqual(new Set(['v1-draft-2']));
      t.lift('a', '2026-12-03', 1150);
      t.standardsChanged.value = true;
      expect((await t.service.group('a', t.groupId)).own).toMatchObject({ score: 1208, improvementBp: 1500, bonusBp: 500 });
      expect(t.strengthCalls.at(-1)?.[3]).toEqual(entry['lockedStandard']);
    });

    it('an entry locked before copies were kept falls back to its version name, and withholds the bonus if it is gone', async () => {
      const t = await season();
      for (const doc of t.entries.docs) delete (doc as Record<string, unknown>)['lockedStandard'];
      t.lift('a', '2026-12-03', 1150);
      t.standardsChanged.value = true;
      expect((await t.service.group('a', t.groupId)).own).toMatchObject({ score: 1150, improvementBp: 1500, bonusBp: 0, bonusWithheld: 'standards_changed' });
    });

    it('freezes results once grace ends, tells members once, and later edits change nothing', async () => {
      const t = await season();
      t.lift('a', '2026-12-03', 1100);
      t.lift('b', '2026-12-04', 1300);
      t.setNow('2027-01-03T23:59:59Z');
      expect((await t.service.group('a', t.groupId)).final).toBe(false);
      expect(t.reminders.filter((r) => r.type === 'tournamentResultsReady')).toHaveLength(0);
      t.setNow('2027-01-04T00:00:00Z');
      expect(await t.service.finalizeDue()).toBe(1);
      expect(await t.service.finalizeDue()).toBe(0);
      const ready = t.reminders.filter((r) => r.type === 'tournamentResultsReady').map((r) => r.recipientId).sort();
      expect(ready).toEqual(['a', 'b', 'c', 'd']);
      // History deleted or added after the freeze: nothing moves.
      t.history.set('b', []);
      t.lift('c', '2026-12-31', 1900, '2026-12-31T20:00:00Z');
      const view = await t.service.group('a', t.groupId);
      expect(view.final).toBe(true);
      expect(view.standings.map((row) => [row.userId, row.place])).toEqual([
        ['b', 1],
        ['a', 2],
        ['c', undefined],
        ['d', undefined],
      ]);
      expect((await t.service.overview('a')).entries[0].result).toEqual({ place: 2, of: 4, score: 1137 });
      expect(t.reminders.filter((r) => r.type === 'tournamentResultsReady')).toHaveLength(4);
    });

    it('a withdrawal after the results still takes effect: places are recomputed from frozen scores', async () => {
      const t = await season();
      t.lift('a', '2026-12-03', 1100);
      t.lift('b', '2026-12-04', 1300);
      t.setNow('2027-01-05T00:00:00Z');
      await t.service.finalizeDue();
      const entry = (await t.service.overview('b')).entries[0];
      await t.service.withdraw('b', entry.id);
      expect((await t.places()).slice(0, 1)).toEqual([['a', 1, 1137]]);
      expect((await t.service.overview('a')).entries[0].result).toEqual({ place: 1, of: 3, score: 1137 });
    });
  });
});
