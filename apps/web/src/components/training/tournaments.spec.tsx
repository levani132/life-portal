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
      members: [
        { userId: 'me', displayName: 'Me', username: 'me', self: true },
        { self: false },
      ],
      standings: null,
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

it('lists a group without any standing, and hides a blocked member’s identity', () => {
  render(<GroupList groupId="g" />);
  expect(screen.getByText('Me')).toBeTruthy();
  expect(screen.getByText('A member')).toBeTruthy();
  expect(screen.getByText(/Nothing here is a ranking/)).toBeTruthy();
  expect(screen.queryByText(/kg|score/i)).toBeNull();
});

it('explains sparse, unranked and voided entries honestly', () => {
  const entry = (status: TournamentEntry['status'], extra: Partial<TournamentEntry> = {}): TournamentEntry => ({
    id: 'e', exerciseId: 'x', exerciseName: 'Bench', season, category: 'men', status, joinedAt: '2026-11-25T00:00:00.000Z', ...extra,
  });
  expect(entryStatusText(entry('no_tournament'))).toMatch(/Fewer than 3 .* Nobody is invented/);
  expect(entryStatusText(entry('not_ranked'))).toMatch(/no current rank/);
  expect(entryStatusText(entry('voided', { voidReason: 'Impossible set' }))).toBe('Removed from this tournament: Impossible set');
});
