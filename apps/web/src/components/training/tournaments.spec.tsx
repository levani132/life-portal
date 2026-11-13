import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SeasonView, TournamentEntry } from '@life-portal/shared-types';
import { GroupList, JoinConsent, entryStatusText } from './tournaments';
import { api } from '../../lib/api';

jest.mock('../../lib/api', () => ({ api: { post: jest.fn(), delete: jest.fn() } }));
jest.mock('../../lib/hooks', () => ({
  useApi: () => ({
    data: {
      id: 'g',
      exerciseId: 'x',
      exerciseName: 'Bench',
      season,
      category: 'women',
      rankRange: 'Achiever III – Veteran I',
      method: 'e1rm',
      standardsVersion: 'v1',
      final: false,
      standings: [
        { self: false, place: 1, score: 1370 },
        { userId: 'me', displayName: 'Me', username: 'me', self: true, place: 2, score: 1137 },
        { userId: 'z', displayName: 'Zed', username: 'z', self: false },
      ],
      own: { score: 1137, strengthScore: 1100, baseline: 1000, improvementBp: 1000, bonusBp: 333, day: '2026-12-03' },
    },
  }),
}));

const season: SeasonView = {
  id: '2026-12',
  firstDay: '2026-12-01',
  lastDay: '2026-12-31',
  enrolOpensAt: '2026-11-20T00:00:00.000Z',
  locksAt: '2026-12-01T00:00:00.000Z',
  endsAt: '2027-01-01T00:00:00.000Z',
  finalizesAt: '2027-01-04T00:00:00.000Z',
  phase: 'enrolling',
};

it('asks for an explicit category and agreement after showing what joining shares', async () => {
  const done = jest.fn();
  (api.post as jest.Mock).mockResolvedValue({});
  render(<JoinConsent season={season} exerciseId="x" standards="women" consentVersion={1} retentionMonths={12} onDone={done} onCancel={jest.fn()} />);
  const join = screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement;
  // Nothing preselected: the private standards setting is never turned into a category silently.
  expect((screen.getByLabelText('Women’s') as HTMLInputElement).checked).toBe(false);
  expect(join.disabled).toBe(true);
  expect(screen.getByText(/Never your weights, reps, body weight/)).toBeTruthy();
  expect(screen.getByText(/kept for 12 months/)).toBeTruthy();
  expect(screen.getByText(/There are no prizes/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Women’s'));
  expect(join.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(join);
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(api.post).toHaveBeenCalledWith('/tournaments/entries', { exerciseId: 'x', season: '2026-12', category: 'women', consentVersion: 1 });
});

it('shows places and scores, hides a blocked member’s identity, and explains only the viewer’s own score', () => {
  render(<GroupList groupId="g" />);
  expect(screen.getByText('A member')).toBeTruthy();
  expect(screen.getByText('1st')).toBeTruthy();
  expect(screen.getByText(/standards v1, fixed for the month/)).toBeTruthy();
  expect(screen.getByLabelText('No place')).toBeTruthy();
  expect(screen.getByText('1.37× body weight')).toBeTruthy();
  expect(screen.getByText('no valid set yet')).toBeTruthy();
  const own = screen.getByLabelText('How your score is worked out');
  expect(own.textContent).toContain('Your score: 1.14× body weight');
  expect(own.textContent).toContain('Improvement 10.00% → bonus +3.33%');
  expect(own.textContent).toContain('1.10× body weight × 1.0333 = 1.14× body weight');
  // Nobody else's breakdown, load or body weight appears.
  expect(screen.queryByText(/kg/)).toBeNull();
});

it('explains sparse, unranked and voided entries honestly', () => {
  const entry = (status: TournamentEntry['status'], extra: Partial<TournamentEntry> = {}): TournamentEntry => ({
    id: 'e', exerciseId: 'x', exerciseName: 'Bench', season, category: 'men', status, joinedAt: '2026-11-25T00:00:00.000Z', ...extra,
  });
  expect(entryStatusText(entry('no_tournament'))).toMatch(/Fewer than 3 .* Nobody is invented/);
  expect(entryStatusText(entry('not_ranked'))).toMatch(/no current rank/);
  expect(entryStatusText(entry('not_eligible'))).toMatch(/Machine and cable lifts have no tournament/);
  expect(entryStatusText(entry('voided', { voidReason: 'Impossible set' }))).toBe('Removed from this tournament: Impossible set');
  expect(entryStatusText(entry('grouped', { result: { place: 2, of: 7, score: 1137 } }))).toBe('Final result: 2nd of 7.');
  expect(entryStatusText(entry('grouped', { result: { of: 7 } }))).toMatch(/no valid set this month, so no place/);
});
