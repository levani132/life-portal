import { fireEvent, render, screen } from '@testing-library/react';
import TrainingPage from '../../app/training/page';
import { TrainingSettings } from './training-settings';

let current: { status: 'open' | 'finished' } | null = null;
jest.mock('../../lib/training-offline', () => ({
  useCurrentSession: (enabled = true) => ({ data: enabled ? current : undefined }),
  useHistoryPage: () => ({ data: { sessions: [] }, isLoading: false }),
  useSessionDetail: () => ({}),
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
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div data-testid="title-row">
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
jest.mock('./workout-session', () => ({
  CurrentWorkout: () => <p>Workout screen</p>,
  WorkoutSession: () => null,
}));
jest.mock('./training-hero', () => ({ TrainingHero: () => null }));
jest.mock('./plans', () => ({ Plans: () => <p>Plans screen</p> }));
jest.mock('./exercise-library', () => ({ ExerciseLibrary: () => null }));

beforeEach(() => {
  current = null;
});

describe('the Training page header (#26)', () => {
  it('drops the title row while a workout is open on the Workout tab, keeping the heading for screen readers', () => {
    current = { status: 'open' };
    render(<TrainingPage />);
    expect(screen.queryByTestId('title-row')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Training' }).className).toContain('sr-only');
    expect(screen.getByText('Workout screen')).toBeTruthy();
  });

  it('keeps the title row and its gear with no workout open', () => {
    render(<TrainingPage />);
    expect(screen.getByTestId('title-row')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Training settings' })).toBeTruthy();
  });

  it('brings the title row back on the other tabs while a workout is open', () => {
    current = { status: 'open' };
    render(<TrainingPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Plans/ }));
    expect(screen.getByTestId('title-row')).toBeTruthy();
    expect(screen.getByText('Plans screen')).toBeTruthy();
  });
});

describe("the workout card's gear (#26)", () => {
  it('opens Training settings in one tap', () => {
    render(<TrainingSettings onDark />);
    fireEvent.click(screen.getByRole('button', { name: 'Training settings' }));
    expect(screen.getByRole('dialog', { name: 'Training settings' })).toBeTruthy();
  });
});
