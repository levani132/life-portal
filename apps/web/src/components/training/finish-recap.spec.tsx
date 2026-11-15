import { act, fireEvent, render, screen } from '@testing-library/react';
import type { SessionDetail, SessionExercise, WorkoutRecap } from '@life-portal/shared-types';
import { FinishSheet } from './finish-sheet';
import { WorkoutRecapView } from './workout-recap';
import { trainingWrites } from '../../lib/training-offline';

const responses: Record<string, unknown> = {};
let pending = false;
let offline = false;
jest.mock('../../lib/hooks', () => ({
  useApi: (url: string | null) => (url ? { data: responses[url], isLoading: false } : { isLoading: false }),
}));
jest.mock('../../lib/training', () => ({
  ...jest.requireActual('../../lib/training'),
  useTrainingProfile: () => ({ weightUnit: 'kg', defaultRestSeconds: 90, loaded: true }),
  useWorkoutDay: () => () => '2026-11-15',
}));
jest.mock('../../lib/training-offline', () => ({
  trainingWrites: { patchSession: jest.fn(async () => undefined), weighIn: jest.fn(async () => undefined), finish: jest.fn(async () => undefined) },
  useTrainingWrites: () => [],
  useTrainingSync: () => ({ waiting: 0, offline, error: null }),
  hasUnsyncedWrites: () => pending,
}));
jest.mock('./plan-day-update', () => ({ PlanDayUpdate: () => <p>Plan day prompt</p> }));

const exercise = {
  id: 'we1',
  sessionId: 's1',
  exerciseId: 'bench',
  order: 0,
  snapshot: { name: 'Bench Press', equipmentType: 'barbell', measure: 'weight_reps', primaryMuscles: ['chest'] },
  sets: [{ id: 'set1', workoutExerciseId: 'we1', exerciseId: 'bench', order: 0, type: 'working', reps: 5, weightGrams: 100_000, loggedAt: '2026-11-15T10:00:00Z' }],
  openTargets: [],
  skipped: false,
} as unknown as SessionExercise;
const session: SessionDetail = {
  id: 's1',
  day: '2026-11-15',
  status: 'open',
  startedAt: '2026-11-15T09:30:00Z',
  durationSeconds: 1800,
  isStale: false,
  version: 3,
  notes: '',
  exercises: [exercise],
};

beforeEach(() => {
  for (const key of Object.keys(responses)) delete responses[key];
  pending = false;
  offline = false;
  jest.clearAllMocks();
});

const confirm = () => act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm & finish workout' })));

describe('the finish sheet (#25)', () => {
  it("finishing with today's weigh-in untouched writes no weigh-in", async () => {
    responses['/training/weigh-ins/recent'] = { weighIns: [{ id: 'w', day: '2026-11-15', weightGrams: 80_000, version: 2 }] };
    const onFinished = jest.fn();
    render(<FinishSheet session={session} elapsedSeconds={1800} onClose={jest.fn()} onFinished={onFinished} />);
    expect((screen.getByLabelText('Body weight in kg') as HTMLInputElement).value).toBe('80');
    await confirm();
    expect(trainingWrites.weighIn).not.toHaveBeenCalled();
    expect(trainingWrites.finish).toHaveBeenCalledWith(session, 'now');
    expect(onFinished).toHaveBeenCalled();
  });

  it("labels a changed weight as replacing today's, and sends it against today's version", async () => {
    responses['/training/weigh-ins/recent'] = { weighIns: [{ id: 'w', day: '2026-11-15', weightGrams: 80_000, version: 2 }] };
    render(<FinishSheet session={session} elapsedSeconds={1800} onClose={jest.fn()} onFinished={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Body weight in kg'), { target: { value: '81,5' } });
    expect(screen.getByRole('status').textContent).toContain("Replaces today's measurement of 80 kg");
    fireEvent.change(screen.getByLabelText('Workout notes'), { target: { value: 'Felt strong' } });
    await confirm();
    expect(trainingWrites.patchSession).toHaveBeenCalledWith(session, { notes: 'Felt strong' });
    expect(trainingWrites.weighIn).toHaveBeenCalledWith('s1', { day: '2026-11-15', weightGrams: 81_500 }, expect.objectContaining({ version: 2 }));
  });

  it('prefills the latest weight but saves it only when ticked', async () => {
    responses['/training/weigh-ins/recent'] = { weighIns: [{ id: 'w', day: '2026-11-10', weightGrams: 81_000, version: 1 }] };
    render(<FinishSheet session={session} elapsedSeconds={1800} onClose={jest.fn()} onFinished={jest.fn()} />);
    expect((screen.getByLabelText('Body weight in kg') as HTMLInputElement).value).toBe('81');
    await confirm();
    expect(trainingWrites.weighIn).not.toHaveBeenCalled();
  });

  it('saves a new weigh-in for today when ticked, as a first weigh-in of the day', async () => {
    responses['/training/weigh-ins/recent'] = { weighIns: [{ id: 'w', day: '2026-11-10', weightGrams: 81_000, version: 1 }] };
    render(<FinishSheet session={session} elapsedSeconds={1800} onClose={jest.fn()} onFinished={jest.fn()} />);
    fireEvent.click(screen.getByLabelText("Save as today's weigh-in"));
    await confirm();
    expect(trainingWrites.weighIn).toHaveBeenCalledWith('s1', { day: '2026-11-15', weightGrams: 81_000 }, undefined);
  });

  it('shows the workout numbers before anything is saved', () => {
    responses['/training/weigh-ins/recent'] = { weighIns: [] };
    render(<FinishSheet session={session} elapsedSeconds={1800} onClose={jest.fn()} onFinished={jest.fn()} />);
    expect(screen.getByText('500 kg')).toBeTruthy(); // 100 kg × 5
    expect(screen.getByText('30:00')).toBeTruthy();
    expect(trainingWrites.finish).not.toHaveBeenCalled();
  });
});

const recap = (overrides: Partial<WorkoutRecap> = {}): WorkoutRecap => ({
  sessionId: 's1',
  day: '2026-11-15',
  status: 'finished',
  totals: { durationSeconds: 1800, exercises: 1, sets: 1, workingSets: 1, reps: 5, volumeGrams: 500_000, setsByMuscle: [{ muscle: 'chest', sets: 1 }] },
  records: [],
  achievements: false,
  ...overrides,
});
const position = (milestone: number, tier: string, division: string) =>
  ({ milestone, tier, division, score: 1000, progress: 0, basis: {} }) as never;

describe('the recap (#25)', () => {
  const finished = { ...session, status: 'finished' as const, plan: { planId: 'p', planWorkoutId: 'd', planName: 'Push Pull', workoutName: 'Push' } };

  it('separates a strength rank-up from the overall level-up', () => {
    responses['/training/sessions/s1/recap'] = recap({
      achievements: true,
      rankUps: [{ exerciseId: 'bench', name: 'Bench Press', from: position(7, 'Challenger', 'II'), to: position(8, 'Challenger', 'I'), version: 'v1' }],
      level: { from: 12, to: 13, xpGained: 110, after: { level: 13, xp: 2000, xpIntoLevel: 10, xpForLevel: 221, countedWorkouts: 20 } },
    });
    render(<WorkoutRecapView session={finished} celebrate onClose={jest.fn()} />);
    expect(screen.getByText('Rank up · Bench Press')).toBeTruthy();
    expect(screen.getByText('Challenger II → Challenger I')).toBeTruthy();
    expect(screen.getByText('You levelled up')).toBeTruthy();
    expect(screen.getByText('Level 12 → 13')).toBeTruthy();
    expect(screen.getByText('Overall training, all exercises')).toBeTruthy();
    // #15's prompt comes after the recap.
    expect(screen.getByText('Plan day prompt')).toBeTruthy();
  });

  it('celebrates nothing it was not told, and still closes the workout warmly', () => {
    responses['/training/sessions/s1/recap'] = recap();
    render(<WorkoutRecapView session={finished} celebrate onClose={jest.fn()} />);
    expect(screen.queryByText(/Rank up/)).toBeNull();
    expect(screen.queryByText(/levelled up/)).toBeNull();
    expect(screen.getByText(/Every session counts/)).toBeTruthy();
  });

  it('offline: shows the numbers, says it is waiting to sync, and no achievements or plan prompt', () => {
    pending = true;
    offline = true;
    render(<WorkoutRecapView session={finished} celebrate onClose={jest.fn()} />);
    expect(screen.getByText(/waiting to sync/)).toBeTruthy();
    expect(screen.getByText('500 kg')).toBeTruthy();
    expect(screen.queryByText('Plan day prompt')).toBeNull();
  });

  it('from History: no entrance animation, and says it is recalculated', () => {
    responses['/training/sessions/s1/recap'] = recap({ achievements: true, records: [{ exerciseId: 'bench', name: 'Bench Press', measure: 'weight_reps', kind: 'heaviest', setId: 'set1' }] });
    const { container } = render(<WorkoutRecapView session={finished} onClose={jest.fn()} />);
    expect(container.ownerDocument.querySelector('.recap-in, .recap-pop')).toBeNull();
    expect(screen.getByText(/Worked out again now/)).toBeTruthy();
    expect(screen.getByText('Personal record')).toBeTruthy();
  });
});
