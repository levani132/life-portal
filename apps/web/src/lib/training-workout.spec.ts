import type { SessionDetail, SessionExercise, WorkoutSet } from '@life-portal/shared-types';
import { forgetDraftsInMemory, saveDraft } from './training-drafts';
import { sessionFocus, setGoal } from './training-workout';

/** Issue #32: an exercise that starts with last time's sets is done after that many, not the plan's. */
const sets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, type: 'working', reps: 8 }) as WorkoutSet);
const exercise = (id: string, logged: number, plan: number, last?: number): SessionExercise =>
  ({
    id,
    sessionId: 'w1',
    sets: sets(logged),
    planned: plan ? { planExerciseId: `p${id}`, targets: Array.from({ length: plan }, () => ({ type: 'working', reps: 12 })) } : undefined,
    previous: last ? { sessionId: 'w0', day: '2026-11-10', sets: sets(last) } : undefined,
    skipped: false,
  }) as SessionExercise;

describe('setGoal', () => {
  it('is last time’s count over the plan’s, the plan’s without history, and 0 when unplanned', () => {
    expect(setGoal(exercise('a', 0, 3, 4))).toBe(4);
    expect(setGoal(exercise('a', 0, 3, 2))).toBe(2);
    expect(setGoal(exercise('a', 0, 3))).toBe(3);
    expect(setGoal(exercise('a', 0, 0, 4))).toBe(0);
  });

  it('keeps an exercise current until last time’s sets are all logged', () => {
    const session = { exercises: [exercise('bench', 3, 3, 4), exercise('squat', 0, 2)] } as unknown as SessionDetail;
    const focus = sessionFocus(session, [], 90);
    expect(focus.doneIds.has('bench')).toBe(false);
    expect(focus.currentId).toBe('bench');
  });
});

describe('rows added or removed in this workout', () => {
  afterEach(() => forgetDraftsInMemory());
  const session = (logged: number) => ({ exercises: [exercise('press', logged, 3), exercise('rdl', 0, 3)] }) as unknown as SessionDetail;

  it('a set added to a three-set exercise makes it a four-set exercise: three logged is not done', () => {
    saveDraft('w1', 'press', { edits: {}, extra: 1 });
    expect(setGoal(exercise('press', 3, 3))).toBe(4);
    const focus = sessionFocus(session(3), [], 90);
    expect(focus.doneIds.has('press')).toBe(false);
    expect(focus.currentId).toBe('press');
  });

  it('is done once the added set is logged too (ticking it uses up the added row)', () => {
    // The set table drops `extra` back to 0 when a row past the starting ones is ticked.
    saveDraft('w1', 'press', { edits: {}, extra: 0 });
    const focus = sessionFocus(session(4), [], 90);
    expect(focus.doneIds.has('press')).toBe(true);
    expect(focus.currentId).toBe('rdl');
  });

  it('a removed row lowers the goal, and other exercises are unaffected', () => {
    saveDraft('w1', 'press', { edits: {}, extra: -1 });
    expect(setGoal(exercise('press', 0, 3))).toBe(2);
    expect(setGoal(exercise('rdl', 0, 3))).toBe(3);
    expect(sessionFocus(session(2), [], 90).doneIds.has('press')).toBe(true);
  });
});
