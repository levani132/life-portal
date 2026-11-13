import { fireEvent, render, screen } from '@testing-library/react';
import type { ExerciseHistory as History, ExerciseListItem, ExerciseProgressView } from '@life-portal/shared-types';
import { ExerciseHistory, TrendText } from './exercise-history';

const responses: Record<string, { data?: unknown; error?: Error }> = {};
const requested: string[] = [];
jest.mock('../../lib/hooks', () => ({
  ...jest.requireActual('../../lib/hooks'),
  useApi: (url: string | null) => {
    if (url) requested.push(url);
    return url ? (responses[url] ?? {}) : {};
  },
}));
let unit: 'kg' | 'lb' = 'kg';
jest.mock('../../lib/training', () => ({
  ...jest.requireActual('../../lib/training'),
  useWeightUnit: () => unit,
  useWorkoutDay: () => () => '2026-11-13',
}));

const exercise: ExerciseListItem = { id: 'e1', name: 'Bench', primaryMuscles: ['chest'], equipmentType: 'barbell', measure: 'weight_reps', isOwn: false };
const view = (overrides: Partial<ExerciseProgressView> = {}): ExerciseProgressView => ({
  exercise,
  range: '3m',
  metrics: ['one_rep_max', 'heaviest', 'volume'],
  points: [
    { day: '2026-10-01', sessionId: 's1', values: { one_rep_max: 110_000, heaviest: 95_000, volume: 2_000_000 } },
    { day: '2026-11-10', sessionId: 's2', values: { one_rep_max: 116_667, heaviest: 100_000, volume: 2_500_000 } },
  ],
  sessionsInRange: 2,
  totalSessions: 5,
  lastDay: '2026-11-10',
  trend: { metric: 'one_rep_max', current: 116_667, previous: 110_000 },
  nextRecord: { kind: 'best_1rm', current: 116_667, target: 120_000, suggestion: { loadGrams: 100_000, reps: 6 } },
  records: [{ kind: 'best_1rm', value: 116_667, setId: 'x', sessionId: 's2', day: '2026-11-10' }],
  ...overrides,
});
const history: History = { exercise, sessions: [], records: [] };
const progressUrl = (range: string) => `/training/exercises/e1/progress?range=${range}&today=2026-11-13`;

beforeEach(() => {
  for (const key of Object.keys(responses)) delete responses[key];
  requested.length = 0;
  unit = 'kg';
  responses['/training/exercises/e1/history'] = { data: history };
});

it('shows key figures, the trend and the next record with its estimate basis', () => {
  responses[progressUrl('3m')] = { data: view() };
  render(<ExerciseHistory exerciseId="e1" />);
  expect(screen.getByText('5')).toBeTruthy();
  expect(screen.getByText("Last 4 weeks").nextElementSibling?.textContent).toBe("▲ Up 6.67 kg");
  expect(screen.getByText('120 kg')).toBeTruthy();
  expect(screen.getByText(/For example 100 kg × 6/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Est. 1RM' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText(/rank/i)).toBeNull();
});

it('asks for the range chosen, with the browser’s day', () => {
  responses[progressUrl('3m')] = { data: view() };
  responses[progressUrl('1y')] = { data: view({ range: '1y' }) };
  render(<ExerciseHistory exerciseId="e1" />);
  fireEvent.click(screen.getByRole('button', { name: '1Y' }));
  expect(requested).toContain(progressUrl('1y'));
  expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true');
});

it('renders weights in pounds when that is the unit', () => {
  unit = 'lb';
  responses[progressUrl('3m')] = { data: view() };
  render(<ExerciseHistory exerciseId="e1" />);
  expect(screen.getByText(/For example 220\.46 lb × 6/)).toBeTruthy();
});

it('says when the range is empty, and when nothing was ever logged', () => {
  responses[progressUrl('3m')] = { data: view({ points: [], sessionsInRange: 0, trend: undefined }) };
  const { unmount } = render(<ExerciseHistory exerciseId="e1" />);
  expect(screen.getByText('No sessions in this range.')).toBeTruthy();
  unmount();
  responses[progressUrl('3m')] = { data: view({ points: [], sessionsInRange: 0, totalSessions: 0, records: [], nextRecord: undefined }) };
  render(<ExerciseHistory exerciseId="e1" />);
  expect(screen.getByText(/Not done yet/)).toBeTruthy();
});

it('treats a faster pace as up', () => {
  render(<TrendText trend={{ metric: 'pace', current: 290, previous: 300 }} unit="kg" />);
  expect(screen.getByText('Up')).toBeTruthy();
  expect(screen.getByText(/0:10 \/km/)).toBeTruthy();
});
