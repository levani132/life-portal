import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ExerciseRankView, RankPosition } from '@life-portal/shared-types';
import { StrengthRank, TrainingLevelLink, formatRankScore } from './strength-rank';
import { api } from '../../lib/api';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('../../lib/api', () => ({ api: { put: jest.fn() } }));
const responses: Record<string, unknown> = {};
const mutate = jest.fn();
jest.mock('../../lib/hooks', () => ({
  useApi: (url: string | null) => (url ? { data: responses[url], mutate } : {}),
}));

const RANK_URL = '/training/exercises/e1/rank?today=2026-11-13';
const access = (trainingRanks: boolean, trainingLevels = false) => ({ access: { trainingRanks, trainingLevels } });
const position = (overrides: Partial<RankPosition> = {}): RankPosition => ({
  milestone: 13,
  tier: 'Veteran',
  division: 'II',
  score: 1333,
  nextScore: 1417,
  progress: 500,
  basis: { setId: 's', sessionId: 'w', day: '2026-11-10', reps: 5, loadGrams: 100_000, oneRepMaxGrams: 116_667, bodyWeightGrams: 82_000, bodyWeightDay: '2026-11-08' },
  ...overrides,
});
const benchmark = { version: 'v1-draft', draft: true, method: 'e1rm' as const, standards: 'men' as const, referenceBodyWeightGrams: 80_000, tierStarts: [0, 500, 750, 1000, 1250, 1500, 1750, 2000], basis: 'Draft standards.' };
const view = (overrides: Partial<ExerciseRankView> = {}): ExerciseRankView => ({
  exerciseId: 'e1',
  status: 'ranked',
  benchmark,
  current: position(),
  highest: { ...position({ milestone: 15, tier: 'Elite', division: 'III', score: 1520 }), version: 'v1-draft' },
  windowDays: 90,
  excluded: { implausible: 0, noBodyWeight: 0, machine: 1 },
  ...overrides,
});

beforeEach(() => {
  for (const key of Object.keys(responses)) delete responses[key];
  jest.clearAllMocks();
});

it('shows nothing without trainingRanks', () => {
  responses['/portal'] = access(false);
  const { container } = render(<StrengthRank exerciseId="e1" today="2026-11-13" />);
  expect(container.textContent).toBe('');
});

it('shows current and highest ranks as text, progress to the next division and the basis', () => {
  responses['/portal'] = access(true);
  responses[RANK_URL] = view();
  render(<StrengthRank exerciseId="e1" today="2026-11-13" />);
  expect(screen.getByText('Veteran II')).toBeTruthy();
  expect(screen.getByText('Elite III')).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe('Veteran II: 1.33× body weight, next division at 1.42× body weight');
  expect(screen.getByText(/100 kg × 5 on/)).toBeTruthy();
  expect(screen.getByText(/body weight 82 kg/)).toBeTruthy();
  expect(screen.getByText(/Draft standards \(v1-draft\)/)).toBeTruthy();
  expect(screen.getByText(/1 set\(s\) on a machine/)).toBeTruthy();
  expect(screen.getByText(/never with other members/)).toBeTruthy();
});

it('says inactive rather than showing a lower rank after 90 days without a valid set', () => {
  responses['/portal'] = access(true);
  responses[RANK_URL] = view({ status: 'inactive', current: undefined });
  render(<StrengthRank exerciseId="e1" today="2026-11-13" />);
  expect(screen.getByText(/Inactive: no valid set in the last 90 days/)).toBeTruthy();
  expect(screen.getByText('Elite III')).toBeTruthy();
});

it('asks for standards, saving the private choice', async () => {
  responses['/portal'] = access(true);
  responses[RANK_URL] = view({ status: 'unranked', reason: 'needs_standards', current: undefined, highest: undefined });
  (api.put as jest.Mock).mockResolvedValue({ weightUnit: 'kg', defaultRestSeconds: 90, rankStandards: 'women' });
  render(<StrengthRank exerciseId="e1" today="2026-11-13" />);
  fireEvent.click(screen.getByRole('button', { name: 'Women’s standards' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/training/profile', { rankStandards: 'women' }));
  await waitFor(() => expect(mutate).toHaveBeenCalled());
});

it('explains why there is no rank', () => {
  responses['/portal'] = access(true);
  responses[RANK_URL] = view({ status: 'unranked', reason: 'no_benchmark', benchmark: undefined, current: undefined, highest: undefined });
  const { rerender } = render(<StrengthRank exerciseId="e1" today="2026-11-13" />);
  expect(screen.getByText(/No strength rank for this exercise/)).toBeTruthy();
  responses[RANK_URL] = view({ status: 'unranked', reason: 'needs_body_weight', current: undefined, highest: undefined });
  rerender(<StrengthRank exerciseId="e1" today="2026-11-13" />);
  expect(screen.getByText(/Log a weigh-in to rank this lift/)).toBeTruthy();
});

it('formats scores and links the account-wide level separately', () => {
  expect(formatRankScore(1250, { method: 'e1rm' })).toBe('1.25× body weight');
  expect(formatRankScore(1, { method: 'reps' })).toBe('1 rep');
  responses['/portal'] = access(true, true);
  responses['/training/level?today=2026-11-13'] = { level: 12, xp: 0, xpIntoLevel: 0, xpForLevel: 1, countedWorkouts: 0 };
  render(<TrainingLevelLink today="2026-11-13" />);
  expect(screen.getByRole('link', { name: 'Training level 12' }).getAttribute('href')).toBe('/training');
  expect(screen.getByText(/account-wide/)).toBeTruthy();
});
