import { act, renderHook } from '@testing-library/react';
import { ApiError, api } from './api';
import { useStartWorkout } from './training';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('./hooks', () => ({
  ...jest.requireActual('./hooks'),
  useApi: () => ({ data: undefined }),
  revalidate: jest.fn(),
}));
jest.mock('./api', () => {
  const actual = jest.requireActual('./api');
  return { ...actual, api: { post: jest.fn(), get: jest.fn(), put: jest.fn(), delete: jest.fn() } };
});

const post = api.post as jest.Mock;
const PLAN = { planId: 'p1', planWorkoutId: 'fb:b' };

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  push.mockReset();
});

describe('useStartWorkout: Home’s Play (issue #7)', () => {
  it('starts the plan’s next workout when the card names one', async () => {
    const { result } = renderHook(() => useStartWorkout());
    await act(() => result.current.start(PLAN));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/training/sessions', expect.objectContaining(PLAN));
    expect(push).toHaveBeenCalledWith('/training');
  });

  it('starts an empty workout without a plan, exactly as before', async () => {
    const { result } = renderHook(() => useStartWorkout());
    await act(() => result.current.start());
    expect(post).toHaveBeenCalledTimes(1);
    const body = post.mock.calls[0][1];
    expect(body).toEqual({ requestId: expect.any(String), day: expect.any(String) });
  });

  it('falls back to an empty workout when the plan or its workout is gone', async () => {
    post.mockRejectedValueOnce(new ApiError('Plan p1 not found', 404));
    const { result } = renderHook(() => useStartWorkout());
    await act(() => result.current.start(PLAN));
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][1]).not.toHaveProperty('planId');
    expect(post.mock.calls[1][1].requestId).not.toBe(post.mock.calls[0][1].requestId);
    expect(result.current.error).toBeNull();
    expect(push).toHaveBeenCalledWith('/training');
  });

  it('shows other failures instead of hiding them behind an empty workout', async () => {
    post.mockRejectedValueOnce(new ApiError('Server error', 500));
    const { result } = renderHook(() => useStartWorkout());
    await act(() => result.current.start(PLAN));
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('Server error');
    expect(push).not.toHaveBeenCalled();
  });

  it('sends one request for a double tap', async () => {
    let finish!: () => void;
    post.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useStartWorkout());
    await act(async () => {
      const first = result.current.start(PLAN);
      void result.current.start(PLAN);
      finish();
      await first;
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
