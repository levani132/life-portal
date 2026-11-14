import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { act, renderHook } from '@testing-library/react';
import { ApiError, NetworkError } from './api';
import { getWithOfflineCopy } from './offline/reads';
import { enqueueWrite } from './offline/runtime';
import { plannedRowId } from './offline/planned-row-id';
import { useStartWorkout } from './training-offline';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('./hooks', () => ({
  ...jest.requireActual('./hooks'),
  useApi: () => ({ data: undefined }),
  revalidate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./offline/reads', () => ({ getWithOfflineCopy: jest.fn() }));
jest.mock('./offline/runtime', () => ({
  enqueueWrite: jest.fn().mockResolvedValue(undefined),
  onWriteDone: jest.fn(),
  subscribeOutbox: jest.fn(),
  outboxItems: () => [],
  outbox: { discard: jest.fn() },
  useOutbox: () => ({ items: [], syncing: false, offline: false }),
}));

const get = getWithOfflineCopy as jest.Mock;
const enqueue = enqueueWrite as jest.Mock;
const PLAN = { planId: 'p1', planWorkoutId: 'fb:b' };
const DETAIL = {
  id: 'p1',
  name: 'Full body',
  isOwn: true,
  archived: false,
  workouts: [
    {
      id: 'fb:b',
      revision: 3,
      name: 'Day B',
      isNext: true,
      exercises: [
        { id: 'pe1', exerciseId: 'x1', exercise: { name: 'Squat', measure: 'weight_reps', equipmentType: 'barbell', archived: false }, targets: [{ type: 'working', reps: 5 }] },
      ],
    },
  ],
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
});

beforeEach(() => {
  enqueue.mockClear();
  push.mockReset();
  get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/training/plans/p1') return DETAIL;
    if (path === '/training/exercises/offline') return [{ id: 'x1', primaryMuscles: ['quads'] }];
    throw new Error(`unexpected ${path}`);
  });
});

describe('useStartWorkout: Home’s Play (issue #7, offline in spec 028)', () => {
  it('starts the plan’s workout with client ids, the server’s derived row ids and the plan copied', async () => {
    const { result } = renderHook(() => useStartWorkout());
    await act(() => result.current.start(PLAN));
    expect(enqueue).toHaveBeenCalledTimes(1);
    const item = enqueue.mock.calls[0][0];
    expect(item).toMatchObject({ kind: 'training.start', method: 'POST', path: '/training/sessions' });
    expect(item.body).toMatchObject({ ...PLAN, requestId: item.id, id: expect.stringMatching(/^[0-9a-f]{24}$/) });
    expect(item.meta.plan).toEqual({ ...PLAN, planName: 'Full body', workoutName: 'Day B' });
    expect(item.meta.rows[0]).toMatchObject({
      id: await plannedRowId(item.id, 'pe1'),
      snapshot: { name: 'Squat', primaryMuscles: ['quads'] },
      planned: { planExerciseId: 'pe1', targets: [{ type: 'working', reps: 5 }] },
    });
    expect(push).toHaveBeenCalledWith('/training');
  });

  it('starts an empty workout without a plan', async () => {
    const { result } = renderHook(() => useStartWorkout());
    await act(() => result.current.start());
    const item = enqueue.mock.calls[0][0];
    expect(Object.keys(item.body).sort()).toEqual(['day', 'id', 'requestId', 'startedAt']);
    expect(item.meta.rows).toEqual([]);
  });

  it('falls back to an empty workout when the plan is gone', async () => {
    get.mockImplementation(async () => {
      throw new ApiError('Plan p1 not found', 404);
    });
    const { result } = renderHook(() => useStartWorkout());
    await act(() => result.current.start(PLAN));
    expect(enqueue.mock.calls[0][0].body).not.toHaveProperty('planId');
    expect(result.current.error).toBeNull();
    expect(push).toHaveBeenCalledWith('/training');
  });

  it('says so when the plan is not on this device and there is no connection', async () => {
    get.mockImplementation(async () => {
      throw new NetworkError();
    });
    const { result } = renderHook(() => useStartWorkout());
    await act(() => result.current.start(PLAN));
    expect(enqueue).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/not saved on this device/);
  });

  it('shows other failures instead of hiding them behind an empty workout', async () => {
    get.mockImplementation(async () => {
      throw new ApiError('Server error', 500);
    });
    const { result } = renderHook(() => useStartWorkout());
    await act(() => result.current.start(PLAN));
    expect(enqueue).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Server error');
  });
});
