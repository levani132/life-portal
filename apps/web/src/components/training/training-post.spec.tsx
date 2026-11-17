import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TrainingAttachment } from '@life-portal/shared-types';
import { CopyTrainingSheet, TrainingAttachmentView } from './training-post';

const post = jest.fn();
const responses: Record<string, unknown> = {};
jest.mock('../../lib/api', () => ({
  ...jest.requireActual('../../lib/api'),
  api: { post: (...args: unknown[]) => post(...args) },
}));
jest.mock('../../lib/hooks', () => ({
  useApi: (key: string | null) => ({ data: key ? responses[key] : undefined, mutate: jest.fn() }),
}));
jest.mock('swr', () => ({ mutate: jest.fn() }));

const bench = { key: '0', name: 'Bench press', primaryMuscles: ['chest' as const], equipmentType: 'barbell' as const, measure: 'weight_reps' as const, exerciseId: 'a'.repeat(24) };
const workout = (logged?: boolean, records?: boolean): TrainingAttachment => ({
  kind: 'workout',
  label: 'Push day',
  exercises: [bench],
  workout: {
    name: 'Push day',
    day: '2026-11-16',
    durationSeconds: 3600,
    exercises: [{ key: '0', setTypes: ['working', 'working'], ...(logged ? { logged: [{ type: 'working', reps: 5, weightGrams: 100_000 }, { type: 'working', reps: 5, weightGrams: 100_000 }] } : {}) }],
    ...(records ? { records: [{ key: '0', kind: 'heaviest' as const, value: 100_000 }] } : {}),
  },
});
const plan: TrainingAttachment = {
  kind: 'plan',
  label: 'PPL',
  exercises: [bench],
  plan: { name: 'PPL', includedWorkouts: 1, totalWorkouts: 5, workouts: [{ name: 'Push', exercises: [{ key: '0', targets: [{ type: 'working', reps: 8, repsMax: 12 }] }] }] },
};

beforeEach(() => {
  post.mockReset();
  for (const key of Object.keys(responses)) delete responses[key];
  responses['/portal'] = { access: { training: true } };
  responses['/training/profile'] = { weightUnit: 'kg', defaultRestSeconds: 90 };
});

describe('TrainingAttachmentView (spec 036)', () => {
  it('shows a workout as exercises and set counts, with no weight unless it was shared', () => {
    const { unmount } = render(<TrainingAttachmentView training={workout()} />);
    expect(screen.getByText('Bench press')).toBeTruthy();
    expect(screen.getByText('2 sets')).toBeTruthy();
    expect(screen.queryByText(/100 kg/)).toBeNull();
    unmount();
    render(<TrainingAttachmentView training={workout(true)} />);
    expect(screen.getByText('2 × 100 kg × 5')).toBeTruthy();
  });

  it('shows a record only when the post carries one', () => {
    render(<TrainingAttachmentView training={workout(false, true)} />);
    expect(screen.getByText(/100 kg/)).toBeTruthy();
  });

  it('says a partial plan is part of a larger one, and shows its planned sets', () => {
    render(<TrainingAttachmentView training={plan} />);
    expect(screen.getByText(/1 of 5 workouts/)).toBeTruthy();
    expect(screen.getByText('8–12 reps')).toBeTruthy();
  });
});

describe('the feed summary', () => {
  const day = (name: string) => ({ name, exercises: [{ key: '0', targets: [{ type: 'working' as const, reps: 8 }] }] });
  const five: TrainingAttachment = { ...plan, plan: { name: 'PPL', includedWorkouts: 5, totalWorkouts: 5, workouts: ['Push', 'Pull', 'Legs', 'Arms', 'Core'].map(day) } };

  it('lists a plan\'s days by name without their sets, and says how many more are in the post', () => {
    render(<TrainingAttachmentView training={five} compact />);
    expect(screen.getByText('Push')).toBeTruthy();
    expect(screen.getByText('2 more in the post')).toBeTruthy();
    // The fifth day is not on the card at all, and no planned set is spelled out.
    expect(screen.queryByText('Core')).toBeNull();
    expect(screen.queryByText('8 reps')).toBeNull();
  });

  it('shows no fade or count when the whole plan fits', () => {
    render(<TrainingAttachmentView training={plan} compact />);
    expect(screen.queryByText(/more in the post/)).toBeNull();
  });

  it('sums a workout up in a line, with its exercise names and no weights', () => {
    render(<TrainingAttachmentView training={workout(true, true)} compact />);
    expect(screen.getByText(/1 exercise · 2 sets/)).toBeTruthy();
    expect(screen.getByText('1 record')).toBeTruthy();
    expect(screen.queryByText(/100 kg/)).toBeNull();
  });
});

describe('CopyTrainingSheet (spec 036)', () => {
  it('asks which plan a single workout goes into, and sends that choice once', async () => {
    responses['/posts/p1/training-copy'] = { kind: 'workout', needsPlanChoice: true, newExercises: [] };
    responses['/training/plans'] = { shared: [], own: [{ id: 'plan-1', name: 'My plan', workoutCount: 2 }] };
    post.mockResolvedValue({ kind: 'workout', planId: 'plan-1', planWorkoutId: 'p1', reused: false });
    render(<CopyTrainingSheet postId="p1" training={workout()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/posts/p1/training-copy');
    expect(post.mock.calls[0][1]).toMatchObject({ planId: 'plan-1' });
    expect(post.mock.calls[0][1].planName).toBeUndefined();
    expect(await screen.findByText(/Nothing was started or logged/)).toBeTruthy();
  });

  it('copies a whole plan in one tap with no plan choice', async () => {
    responses['/posts/p2/training-copy'] = { kind: 'plan', needsPlanChoice: false, newExercises: ['My fly'] };
    post.mockResolvedValue({ kind: 'plan', planId: 'new', reused: false });
    const five = { ...plan, plan: { ...plan.plan!, includedWorkouts: 2, workouts: [plan.plan!.workouts[0], plan.plan!.workouts[0]] } };
    render(<CopyTrainingSheet postId="p2" training={five} onClose={jest.fn()} />);
    expect(screen.queryByLabelText('Plan')).toBeNull();
    expect(screen.getByText(/Also adds to your own exercises: My fly/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy plan' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(Object.keys(post.mock.calls[0][1])).toEqual(['requestId']);
  });

  it('shows the copy already made instead of offering another', () => {
    responses['/posts/p3/training-copy'] = { kind: 'plan', needsPlanChoice: false, newExercises: [], existing: { kind: 'plan', planId: 'x', reused: true } };
    render(<CopyTrainingSheet postId="p3" training={plan} onClose={jest.fn()} />);
    expect(screen.getByText(/among your own plans/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull();
  });
});
