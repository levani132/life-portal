import { combinedText, conflictOf, diffFields, earlierEditsOf, editOf, laterEditsOf, rebased } from './conflicts';
import { applyWrite, versionAfter } from './training-overlay';
import { overlayOverview } from './nutrition-overlay';
import type { OutboxItem } from './types';
import type { NutritionOverview, SessionDetail } from '@life-portal/shared-types';

const item = (over: Partial<OutboxItem>): OutboxItem => ({
  id: 'i1',
  seq: 1,
  kind: 'training.set.patch',
  method: 'PATCH',
  path: '/training/sets/s1',
  state: 'pending',
  attempts: 0,
  nextAttemptAt: 0,
  createdAt: 0,
  ...over,
});

const setEdit = (over: Partial<OutboxItem> = {}) =>
  item({
    meta: { op: 'set.patch', sessionId: 'w1', setId: 's1', patch: { reps: 8 }, baseVersion: 0 },
    body: { reps: 8, baseVersion: 0 },
    ...over,
  });

describe('edits from two devices (spec 030)', () => {
  it('reads a STALE_EDIT refusal as mine against theirs, field by field', () => {
    const refused = setEdit({
      state: 'conflict',
      lastErrorCode: 'STALE_EDIT',
      lastErrorCurrent: { set: { id: 's1', reps: 6, weightGrams: 60_000, version: 1 }, records: [] },
    });
    const clash = conflictOf(refused);
    expect(clash).toMatchObject({ type: 'stale', version: 1, edit: { kind: 'set', rowKey: 'set:s1' } });
    expect(diffFields(clash as Extract<typeof clash, { type: 'stale' }>)).toEqual([
      { field: 'reps', label: 'Reps', mine: '8', theirs: '6', text: false },
    ]);
  });

  it('reads ROW_DELETED as a deleted row, and nothing else as a clash', () => {
    expect(conflictOf(setEdit({ state: 'conflict', lastErrorCode: 'ROW_DELETED' }))).toMatchObject({ type: 'deleted' });
    expect(conflictOf(setEdit({ state: 'conflict', lastErrorCode: 'SESSION_CONFLICT' }))).toBeUndefined();
    expect(conflictOf(setEdit({ state: 'error', lastErrorCode: 'STALE_EDIT', lastErrorCurrent: {} }))).toBeUndefined();
  });

  it('always shows both weigh-ins, even when only the body fat differs', () => {
    const refused = item({
      kind: 'nutrition.weighin.put',
      state: 'conflict',
      lastErrorCode: 'STALE_EDIT',
      lastErrorCurrent: { day: '2026-11-14', weightGrams: 80_000, version: 1 },
      meta: { op: 'weighin.put', day: '2026-11-14', weightGrams: 80_000, bodyFatPct: 0.2, baseVersion: 0 },
    });
    const clash = conflictOf(refused) as Extract<ReturnType<typeof conflictOf>, { type: 'stale' }>;
    expect(diffFields(clash).map((diff) => [diff.label, diff.mine, diff.theirs])).toEqual([
      ['Weight', '80 kg', '80 kg'],
      ['Body fat', '20%', '—'],
    ]);
  });

  it('offers a combined note that the person edits, never a silent concatenation', () => {
    expect(combinedText('Elbows in', 'Pause at the bottom')).toBe('Elbows in\n\nPause at the bottom');
    expect(combinedText('Same', 'Same')).toBe('Same');
    expect(combinedText(undefined, 'Only mine')).toBe('Only mine');
    const refused = item({
      kind: 'training.session.patch',
      state: 'conflict',
      lastErrorCode: 'STALE_EDIT',
      lastErrorCurrent: { id: 'w1', notes: 'Elbows in', version: 2 },
      meta: { op: 'session.patch', sessionId: 'w1', patch: { notes: 'Pause' }, baseVersion: 1 },
    });
    const clash = conflictOf(refused) as Extract<ReturnType<typeof conflictOf>, { type: 'stale' }>;
    expect(diffFields(clash)).toEqual([{ field: 'notes', label: 'Notes', mine: 'Pause', theirs: 'Elbows in', text: true }]);
  });

  it('turns "keep mine" into the same edit against the current version', () => {
    const { body, meta } = rebased(setEdit(), 3);
    expect(body).toEqual({ reps: 8, baseVersion: 3 });
    expect(meta).toMatchObject({ patch: { reps: 8 }, baseVersion: 3 });
    const combined = rebased(item({ body: { notes: 'a', baseVersion: 0 }, meta: { op: 'session.patch', sessionId: 'w1', patch: { notes: 'a' }, baseVersion: 0 } }), 2, { notes: 'a\n\nb' });
    expect(combined.body).toEqual({ notes: 'a\n\nb', baseVersion: 2 });
    expect(combined.meta).toMatchObject({ patch: { notes: 'a\n\nb' } });
    const weighIn = rebased(item({ body: { day: 'd', weightGrams: 1, baseVersion: 0 }, meta: { op: 'weighin.put', day: 'd', weightGrams: 1, baseVersion: 0 } }), 1);
    expect(weighIn.meta).toMatchObject({ baseVersion: 1, weightGrams: 1 });
  });

  it('orders edits of one row: a second waits for the first, and is found to be rebased with it', () => {
    const first = setEdit();
    const other = item({ id: 'x', seq: 2, meta: { op: 'set.patch', sessionId: 'w1', setId: 's2', patch: {}, baseVersion: 0 } });
    const second = setEdit({ id: 'i2', seq: 3 });
    expect(earlierEditsOf([first, other], { kind: 'training.set.patch', meta: second.meta })).toEqual(['i1']);
    expect(laterEditsOf([first, other, second], first).map((next) => next.id)).toEqual(['i2']);
    expect(editOf({ kind: 'training.set.add', meta: {} })).toBeUndefined();
  });
});

describe('versions on screen before the server answers (spec 030)', () => {
  it('makes a second queued edit against the version the first will produce, and stays right after the refetch', () => {
    expect(versionAfter({ version: 0 }, 0)).toEqual({ version: 1 });
    expect(versionAfter({ version: 1 }, 1)).toEqual({ version: 2 });
    // The refetch already has the first edit (version 1) while it is still applied.
    expect(versionAfter({ version: 1 }, 0)).toEqual({ version: 1 });
    expect(versionAfter({}, undefined)).toEqual({});
    const session = { id: 'w1', exercises: [], status: 'open', day: 'd', startedAt: '', durationSeconds: 0, isStale: false } as unknown as SessionDetail;
    expect(applyWrite(session, { op: 'session.patch', sessionId: 'w1', patch: { notes: 'n' }, baseVersion: 0 })).toMatchObject({ notes: 'n', version: 1 });
  });

  it('does the same for a corrected meal and a weigh-in', () => {
    const entry = { id: 'e1', day: '2026-11-14', slot: 'lunch', foodId: 'f', amount: 100, unit: 'g', facts: { name: 'x', servingSize: 100, energyKcalPer100: 100, proteinMgPer100: 0, fatMgPer100: 0, carbMgPer100: 0 }, version: 2 };
    const base = {
      day: '2026-11-14',
      dayTotals: { day: '2026-11-14', slots: [{ slot: 'lunch', entries: [entry] }], totals: { energyKcal: 100 }, entryCount: 1 },
      week: { days: [], eatenKcal: 0 },
      weighIns: [{ id: 'w', day: '2026-11-14', weightGrams: 80_000, version: 1 }],
    } as unknown as NutritionOverview;
    const day = overlayOverview(base, [
      { meta: { op: 'entry.patch', entryId: 'e1', patch: { amount: 150 }, baseVersion: 2 } },
      { meta: { op: 'weighin.put', day: '2026-11-14', weightGrams: 79_000, baseVersion: 1 } },
    ]);
    expect(day.dayTotals.slots.flatMap((slot) => slot.entries)[0]).toMatchObject({ amount: 150, version: 3 });
    expect(day.weighIns[0]).toMatchObject({ weightGrams: 79_000, version: 2 });
  });
});
