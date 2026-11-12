import {
  isSupersetKey,
  linkWithNext,
  restAfter,
  supersetRuns,
  unlinkFromNext,
  workoutFocus,
  type FocusExercise,
} from './training-workout';

const ex = (id: string, extra: Partial<FocusExercise> = {}): FocusExercise => ({
  id,
  skipped: false,
  targetCount: 3,
  logged: 0,
  ...extra,
});

let counter = 0;
const makeKey = () => `k${++counter}`;

describe('isSupersetKey', () => {
  it('accepts short url-safe keys only', () => {
    expect(isSupersetKey('a1_B-2')).toBe(true);
    expect(isSupersetKey('')).toBe(false);
    expect(isSupersetKey('has space')).toBe(false);
    expect(isSupersetKey('x'.repeat(41))).toBe(false);
    expect(isSupersetKey(7)).toBe(false);
  });
});

describe('supersetRuns', () => {
  it('groups neighbours with the same key and labels runs in order', () => {
    const runs = supersetRuns([
      { id: 'a', superset: 'x' },
      { id: 'b', superset: 'x' },
      { id: 'c' },
      { id: 'd', superset: 'y' },
      { id: 'e', superset: 'y' },
      { id: 'f', superset: 'y' },
    ]);
    expect(runs.get('a')).toEqual({ label: 'A', position: 1, size: 2, ids: ['a', 'b'] });
    expect(runs.get('b')?.position).toBe(2);
    expect(runs.has('c')).toBe(false);
    expect(runs.get('f')).toMatchObject({ label: 'B', position: 3, size: 3 });
  });

  it('ignores a lone key and a same key that is not adjacent', () => {
    const runs = supersetRuns([{ id: 'a', superset: 'x' }, { id: 'b' }, { id: 'c', superset: 'x' }]);
    expect(runs.size).toBe(0);
  });
});

describe('linkWithNext / unlinkFromNext', () => {
  it('links two plain exercises under a new key', () => {
    expect(linkWithNext([undefined, undefined, undefined], 0, () => 'n')).toEqual(['n', 'n', undefined]);
  });

  it('extends an existing superset and merges two', () => {
    expect(linkWithNext(['x', 'x', undefined], 1, makeKey)).toEqual(['x', 'x', 'x']);
    expect(linkWithNext([undefined, 'y', 'y'], 0, makeKey)).toEqual(['y', 'y', 'y']);
    expect(linkWithNext(['x', 'x', 'y', 'y'], 1, makeKey)).toEqual(['x', 'x', 'x', 'x']);
  });

  it('does nothing for the last exercise', () => {
    expect(linkWithNext([undefined], 0, makeKey)).toEqual([undefined]);
  });

  it('unlinking a pair clears both', () => {
    expect(unlinkFromNext(['x', 'x'], 0, makeKey)).toEqual([undefined, undefined]);
  });

  it('unlinking the middle of three leaves the longer side a superset', () => {
    expect(unlinkFromNext(['x', 'x', 'x'], 0, () => 'n')).toEqual([undefined, 'n', 'n']);
    expect(unlinkFromNext(['x', 'x', 'x'], 1, () => 'n')).toEqual(['x', 'x', undefined]);
  });

  it('does nothing when the two are not linked', () => {
    expect(unlinkFromNext(['x', 'y'], 0, makeKey)).toEqual(['x', 'y']);
  });
});

describe('workoutFocus', () => {
  it('starts at the first exercise', () => {
    expect(workoutFocus([ex('a'), ex('b')]).currentId).toBe('a');
  });

  it('marks a planned exercise done once its targets are logged, and moves on', () => {
    const focus = workoutFocus([ex('a', { logged: 3 }), ex('b')], 'a');
    expect([...focus.doneIds]).toEqual(['a']);
    expect(focus.currentId).toBe('b');
  });

  it('keeps an exercise done when extra sets are logged on it', () => {
    const focus = workoutFocus([ex('a', { logged: 4 }), ex('b')], 'a');
    expect(focus.doneIds.has('a')).toBe(true);
    expect(focus.currentId).toBe('b');
  });

  it('follows the last set to an earlier unfinished exercise', () => {
    const focus = workoutFocus([ex('a', { logged: 1 }), ex('b', { logged: 1 })], 'a');
    expect(focus.currentId).toBe('a');
  });

  it('skips skipped exercises and never calls them done', () => {
    const focus = workoutFocus([ex('a', { skipped: true }), ex('b')]);
    expect(focus.currentId).toBe('b');
    expect(focus.doneIds.size).toBe(0);
  });

  it('an exercise with no plan is current while in use, and done once the person moves on', () => {
    const adHoc = (id: string, logged: number) => ex(id, { targetCount: 0, logged });
    expect(workoutFocus([adHoc('a', 2), adHoc('b', 0)], 'a')).toEqual({ doneIds: new Set(), currentId: 'a' });
    expect(workoutFocus([adHoc('a', 2), adHoc('b', 1)], 'b')).toEqual({ doneIds: new Set(['a']), currentId: 'b' });
  });

  it('has no current exercise when everything is done', () => {
    expect(workoutFocus([ex('a', { logged: 3 })], 'a').currentId).toBeUndefined();
  });

  it('goes round a superset, then on when the superset is done', () => {
    const list = (a: number, b: number) => [
      ex('a', { superset: 's', logged: a }),
      ex('b', { superset: 's', logged: b }),
      ex('c'),
    ];
    expect(workoutFocus(list(1, 0), 'a').currentId).toBe('b');
    expect(workoutFocus(list(1, 1), 'b').currentId).toBe('a');
    expect(workoutFocus(list(3, 2), 'a').currentId).toBe('b');
    expect(workoutFocus(list(3, 3), 'b').currentId).toBe('c');
  });

  it('keeps unplanned superset members current until the person leaves the superset', () => {
    const list = [
      ex('a', { superset: 's', targetCount: 0, logged: 2 }),
      ex('b', { superset: 's', targetCount: 0, logged: 2 }),
    ];
    const focus = workoutFocus(list, 'b');
    expect(focus.doneIds.size).toBe(0);
    expect(focus.currentId).toBe('a');
  });
});

describe('restAfter', () => {
  const list = [
    ex('a', { superset: 's', logged: 1, restSeconds: 30 }),
    ex('b', { superset: 's', logged: 0, restSeconds: 120 }),
    ex('c', { restSeconds: 60 }),
    ex('d'),
  ];

  it('is 0 with no set logged', () => {
    expect(restAfter(list, undefined, 'a', 90)).toBe(0);
  });

  it('is 0 mid-way through a superset round', () => {
    expect(restAfter(list, 'a', 'b', 90)).toBe(0);
  });

  it("after a round, is the superset's last member's rest", () => {
    expect(restAfter(list, 'b', 'a', 90)).toBe(120);
  });

  it("is the exercise's own rest, else the default", () => {
    expect(restAfter(list, 'c', 'c', 90)).toBe(60);
    expect(restAfter(list, 'd', 'd', 90)).toBe(90);
  });
});
