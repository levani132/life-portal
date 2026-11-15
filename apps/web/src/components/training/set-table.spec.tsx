import { act, fireEvent, render, screen } from '@testing-library/react';
import type { PlanTarget, SessionExercise, WorkoutSet } from '@life-portal/shared-types';
import { SetTable } from './set-table';
import { clearDrafts, forgetDraftsInMemory } from '../../lib/training-drafts';

/**
 * Issue #32: an exercise starts with last time's sets (count, numbers, type), over the plan; what
 * is typed into rows not yet ticked survives leaving and coming back, and nothing replaces it.
 */
const stored = new Map<string, unknown>();
const cache = {
  get: async (key: string) => stored.get(key),
  put: async (key: string, value: unknown) => void stored.set(key, value),
  remove: async (key: string) => void stored.delete(key),
};
jest.mock('../../lib/offline/runtime', () => ({
  offlineCache: () => cache,
  waitForOfflineCache: async () => cache,
}));
jest.mock('../../lib/api', () => ({ api: {}, ApiError: class extends Error {} }));
jest.mock('../../lib/training-offline', () => ({ trainingWrites: { removeSet: jest.fn(async () => undefined) } }));
jest.mock('../../lib/training', () => ({
  ...jest.requireActual('../../lib/training'),
  useWeightUnit: () => 'kg',
}));

const set = (order: number, kg: number, reps: number, type: WorkoutSet['type'] = 'working'): WorkoutSet => ({
  id: `s${order}`,
  workoutExerciseId: 'old',
  exerciseId: 'bench',
  order,
  type,
  weightGrams: kg * 1000,
  reps,
  loggedAt: `2026-11-10T10:0${order}:00.000Z`,
});

function exercise(options: { previous?: WorkoutSet[]; targets?: PlanTarget[]; sets?: WorkoutSet[] } = {}): SessionExercise {
  return {
    id: 'we1',
    sessionId: 'w1',
    exerciseId: 'bench',
    order: 0,
    snapshot: { name: 'Bench press', measure: 'weight_reps' } as SessionExercise['snapshot'],
    sets: options.sets ?? [],
    ...(options.previous ? { previous: { sessionId: 'w0', day: '2026-11-10', sets: options.previous } } : {}),
    ...(options.targets ? { planned: { planExerciseId: 'p1', targets: options.targets } } : {}),
    openTargets: options.targets ?? [],
    skipped: false,
  };
}

const plan = (n: number): PlanTarget[] => Array.from({ length: n }, () => ({ type: 'working', reps: 12, weightGrams: 80000 }));
const weights = () => screen.getAllByLabelText('Weight in kg').map((input) => (input as HTMLInputElement).value);
const reps = () => screen.getAllByLabelText('Reps').map((input) => (input as HTMLInputElement).value);
const flush = () => act(async () => undefined);

beforeEach(() => {
  stored.clear();
  forgetDraftsInMemory();
});

describe('starting sets', () => {
  it('copies last time over the plan, count included (the issue example)', async () => {
    render(<SetTable exercise={exercise({ targets: plan(3), previous: [set(1, 85, 10), set(2, 85, 9), set(3, 80, 11)] })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    expect(weights()).toEqual(['85', '85', '80']);
    expect(reps()).toEqual(['10', '9', '11']);
  });

  it('starts with as many rows as last time, more or fewer than planned', async () => {
    const { unmount } = render(
      <SetTable exercise={exercise({ targets: plan(3), previous: [set(1, 60, 8), set(2, 60, 8), set(3, 60, 8), set(4, 60, 6)] })} onLog={jest.fn()} onEdit={jest.fn()} />,
    );
    await flush();
    expect(weights()).toHaveLength(4);
    unmount();
    render(<SetTable exercise={exercise({ targets: plan(3), previous: [set(1, 60, 8)] })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    expect(weights()).toHaveLength(1);
  });

  it('carries a warm-up over by position', async () => {
    render(<SetTable exercise={exercise({ previous: [set(1, 40, 10, 'warmup'), set(2, 80, 8)] })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    expect(screen.getByRole('button', { name: /Set 1, warm-up/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Set 2, working/i })).toBeTruthy();
  });

  it('uses the plan only when the exercise was never done', async () => {
    render(<SetTable exercise={exercise({ targets: plan(3) })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    expect(weights()).toEqual(['80', '80', '80']);
    expect(reps()).toEqual(['12', '12', '12']);
  });

  it('logs only what is ticked, with the values shown', async () => {
    const onLog = jest.fn();
    render(<SetTable exercise={exercise({ previous: [set(1, 85, 10), set(2, 85, 9)] })} onLog={onLog} onEdit={jest.fn()} />);
    await flush();
    expect(onLog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark set 1 done' }));
    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ type: 'working', weightGrams: 85000, reps: 10 }));
  });
});

describe('drafts', () => {
  const history = [set(1, 85, 10), set(2, 85, 9)];

  it('keeps typed values and added rows across leaving and coming back', async () => {
    const { unmount } = render(<SetTable exercise={exercise({ previous: history })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    fireEvent.change(screen.getAllByLabelText('Reps')[1], { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /Add set/ }));
    await flush();
    unmount();

    render(<SetTable exercise={exercise({ previous: history })} onLog={jest.fn()} onEdit={jest.fn()} />);
    expect(reps()).toEqual(['10', '7', '7']);
  });

  it('restores a draft from the device after a reload', async () => {
    const { unmount } = render(<SetTable exercise={exercise({ previous: history })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    fireEvent.change(screen.getAllByLabelText('Weight in kg')[0], { target: { value: '90' } });
    await flush();
    unmount();
    forgetDraftsInMemory(); // a reload: only the device copy is left

    render(<SetTable exercise={exercise({ previous: history })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    expect(weights()).toEqual(['90', '85']);
  });

  it('never lets a late device copy replace what is being typed now', async () => {
    stored.set('training:draft:w1', { we1: { edits: { 0: { weight: '50', reps: '5', type: 'working', rpe: '' } }, extra: 0 } });
    render(<SetTable exercise={exercise({ previous: history })} onLog={jest.fn()} onEdit={jest.fn()} />);
    // Typed before the device answered.
    fireEvent.change(screen.getAllByLabelText('Weight in kg')[0], { target: { value: '95' } });
    await flush();
    expect(weights()[0]).toBe('95');
  });

  it('keeps edits when last time arrives later, and fills only untouched rows from it', async () => {
    const { rerender } = render(<SetTable exercise={exercise({ targets: plan(2) })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    fireEvent.change(screen.getAllByLabelText('Weight in kg')[0], { target: { value: '70' } });
    rerender(<SetTable exercise={exercise({ targets: plan(2), previous: history })} onLog={jest.fn()} onEdit={jest.fn()} />);
    expect(weights()).toEqual(['70', '85']);
  });

  it('is gone once the workout is over', async () => {
    const { unmount } = render(<SetTable exercise={exercise({ previous: history })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '3' } });
    await flush();
    unmount();
    clearDrafts('w1');
    await flush();
    expect(stored.size).toBe(0);
    render(<SetTable exercise={exercise({ previous: history })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    expect(reps()).toEqual(['10', '9']);
  });

  it('can remove a row that last time started it with', async () => {
    render(<SetTable exercise={exercise({ previous: history })} onLog={jest.fn()} onEdit={jest.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /Set 2, working/i }));
    fireEvent.click(screen.getByRole('button', { name: /Remove set/ }));
    expect(weights()).toEqual(['85']);
  });
});
