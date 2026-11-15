import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import TrainingPage from '../../app/training/page';

/**
 * Issue #30 (correcting #26): Training shows no title row in any tab or state, and its settings
 * gear is the last cell of the tab strip, so it is reachable everywhere in one tap.
 */
let current: { status: 'open' | 'finished' } | null = null;
let history: { id: string }[] = [];
jest.mock('../../lib/training-offline', () => ({
  useCurrentSession: (enabled = true) => ({ data: enabled ? current : undefined }),
  useHistoryPage: () => ({
    data: {
      sessions: history.map((s) => ({
        ...s,
        day: '2026-11-14',
        status: 'finished',
        setCount: 3,
        durationSeconds: 1800,
        exerciseNames: ['Squat'],
      })),
    },
    isLoading: false,
  }),
  useSessionDetail: (id: string) => ({ data: { id } }),
}));
jest.mock('../../lib/training', () => ({
  ...jest.requireActual('../../lib/training'),
  useWorkoutDay: () => () => '2026-11-15',
  useTrainingProfile: () => ({ weightUnit: 'kg', defaultRestSeconds: 90, loaded: true }),
}));
jest.mock('../../lib/api', () => ({ api: { put: jest.fn() } }));
jest.mock('../../lib/hooks', () => ({ revalidate: jest.fn(), useApi: () => ({}) }));
jest.mock('../app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  // Rendering one would be the bug: it is the visible title row.
  PageHeader: ({ title }: { title: string }) => <div data-testid="title-row">{title}</div>,
}));
jest.mock('./workout-session', () => ({
  CurrentWorkout: () => <p>{current?.status === 'open' ? 'Workout in progress' : 'No workout'}</p>,
  WorkoutSession: () => <p>Past workout</p>,
}));
jest.mock('./training-hero', () => ({ TrainingHero: () => null }));
jest.mock('./plans', () => ({ Plans: () => <p>Plans screen</p> }));
jest.mock('./exercise-library', () => ({ ExerciseLibrary: () => <p>Exercise library</p> }));

beforeEach(() => {
  current = null;
  history = [];
});

const TABS = ['Workout', 'Plans', 'History', 'Exercises'] as const;
const STATES = [
  ['with no workout', null],
  ['during a workout', { status: 'open' }],
] as const;

describe.each(STATES)('Training %s', (_label, state) => {
  it.each(TABS)('%s: no title row, one gear, and it opens Training settings', (tab) => {
    current = state ? { ...state } : null;
    render(<TrainingPage />);
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(tab) }));
    expect(screen.getByRole('tab', { name: new RegExp(tab) }).getAttribute('aria-selected')).toBe('true');

    expect(screen.queryByTestId('title-row')).toBeNull();
    // The heading is still there for screen readers, and only for them.
    expect(screen.getByRole('heading', { level: 1, name: 'Training' }).className).toContain('sr-only');

    const gears = screen.getAllByRole('button', { name: 'Training settings' });
    expect(gears).toHaveLength(1);
    fireEvent.click(gears[0]);
    expect(screen.getByRole('dialog', { name: 'Training settings' })).toBeTruthy();
  });
});

it('keeps the gear out of the tab list, so the tabs stay four tabs', () => {
  render(<TrainingPage />);
  const tablist = screen.getByRole('tablist', { name: 'Training' });
  expect(within(tablist).getAllByRole('tab')).toHaveLength(4);
  expect(within(tablist).queryByRole('button', { name: 'Training settings' })).toBeNull();
});

it('keeps the gear and no title row with a past workout open from History', () => {
  history = [{ id: 'w1' }];
  render(<TrainingPage />);
  fireEvent.click(screen.getByRole('tab', { name: /History/ }));
  fireEvent.click(screen.getByRole('button', { name: /Squat/ }));
  expect(screen.getByText('Past workout')).toBeTruthy();
  expect(screen.queryByTestId('title-row')).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Training settings' })).toHaveLength(1);
});

it('does not give the workout card a second gear (the #26 placement)', () => {
  // The card is mocked above, so check its source: it must not render Training settings itself.
  const card = readFileSync(join(__dirname, 'workout-session.tsx'), 'utf8');
  expect(card).not.toMatch(/TrainingSettings/);
});
