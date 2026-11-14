import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ExerciseListItem } from '@life-portal/shared-types';
import { ExerciseSearch } from './exercise-picker';

const SAVED: ExerciseListItem[] = [
  {
    id: 'm',
    name: 'Seated Chest Press (Machine)',
    searchName: 'seated chest press machine | machine bench press | machine chest press | chest press machine',
    primaryMuscles: ['chest'],
    equipmentType: 'machine',
    measure: 'weight_reps',
    isOwn: false,
  },
  { id: 'l', name: 'Leverage Chest Press', searchName: 'leverage chest press | plate loaded chest press', primaryMuscles: ['chest'], equipmentType: 'machine', measure: 'weight_reps', isOwn: false },
  // A device copy saved before #23 has no searchName: the name is searched instead.
  { id: 'c', name: 'Cable Chest Press', primaryMuscles: ['chest'], equipmentType: 'cable', measure: 'weight_reps', isOwn: false },
];

// Offline: the live search has no answer, so the picker searches the device copy.
jest.mock('../../lib/hooks', () => ({
  useApi: (key: string | null) =>
    key === '/training/exercises/offline'
      ? { data: SAVED, isLoading: false }
      : { data: undefined, error: new (jest.requireActual('../../lib/api').NetworkError)(), isLoading: false },
}));

async function searchFor(query: string) {
  cleanup();
  jest.useFakeTimers();
  render(<ExerciseSearch allowCreate={false} />);
  fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: query } });
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
  return SAVED.filter((item) => screen.queryByText(item.name)).map((item) => item.id);
}

describe('the exercise picker offline (#23)', () => {
  it.each(['chest press', 'machine chest press', 'seated chest press', 'machine bench press'])('finds the seated machine for "%s"', async (query) => {
    expect(await searchFor(query)).toContain('m');
  });

  it('keeps the plate-loaded machine separate, and falls back to the name on an old copy', async () => {
    expect(await searchFor('machine bench press')).toEqual(['m']);
    expect(await searchFor('plate loaded')).toEqual(['l']);
    expect(await searchFor('cable chest')).toEqual(['c']);
  });
});
