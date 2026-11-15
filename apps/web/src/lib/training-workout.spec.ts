import type { SessionDetail, SessionExercise, WorkoutSet } from '@life-portal/shared-types';
import { sessionFocus, setGoal } from './training-workout';

/** Issue #32: an exercise that starts with last time's sets is done after that many, not the plan's. */
const sets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, type: 'working', reps: 8 }) as WorkoutSet);
const exercise = (id: string, logged: number, plan: number, last?: number): SessionExercise =>
  ({
    id,
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
