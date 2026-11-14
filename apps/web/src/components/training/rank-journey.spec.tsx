import { render, screen, within } from '@testing-library/react';
import type { ExerciseRankView, RankPosition } from '@life-portal/shared-types';
import { RankEmblem } from './rank-emblem';
import { RankJourney } from './rank-journey';

const position = (overrides: Partial<RankPosition> = {}): RankPosition => ({
  milestone: 10,
  tier: 'Achiever',
  division: 'II',
  score: 1270,
  nextScore: 1300,
  progress: 700,
  basis: { setId: 's', sessionId: 'w', day: '2026-11-10', reps: 1, loadGrams: 101_600, oneRepMaxGrams: 101_600, bodyWeightGrams: 80_000, bodyWeightDay: '2026-11-08' },
  ...overrides,
});
const view = (overrides: Partial<ExerciseRankView> = {}): ExerciseRankView => ({
  exerciseId: 'e1',
  status: 'ranked',
  benchmark: { version: 'v1', draft: false, method: 'e1rm', standards: 'men', referenceBodyWeightGrams: 80_000, tierStarts: [0, 550, 850, 1100, 1400, 1650, 1900, 2150], basis: 'v1' },
  current: position(),
  highest: { ...position(), version: 'v1' },
  windowDays: 90,
  excluded: { implausible: 0, noBodyWeight: 0, machine: 0 },
  ...overrides,
});

describe('RankEmblem (#13)', () => {
  it('shows the division as filled pips, one for III to three for I', () => {
    for (const [division, on] of [['III', 1], ['II', 2], ['I', 3]] as const) {
      const { container, unmount } = render(<RankEmblem tier="Veteran" division={division} />);
      expect(container.querySelectorAll('[data-pip="on"]')).toHaveLength(on);
      expect(container.querySelectorAll('[data-pip="off"]')).toHaveLength(3 - on);
      unmount();
    }
  });

  it('is decorative unless labelled, and a labelled one is an image', () => {
    const { container, rerender } = render(<RankEmblem tier="Initiate" division="III" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<RankEmblem tier="Initiate" division="III" label="Initiate III" />);
    expect(screen.getByRole('img', { name: 'Initiate III' })).toBeTruthy();
  });

  it('turns only an animated Legend, and only where motion is allowed', () => {
    const { container, rerender } = render(<RankEmblem tier="Legend" division="I" animate />);
    const rays = container.querySelector('[data-testid="legend-rays"]');
    expect(rays?.getAttribute('class')).toContain('motion-safe:animate-');
    rerender(<RankEmblem tier="Legend" division="I" />);
    expect(container.querySelector('[data-testid="legend-rays"]')).toBeNull();
    rerender(<RankEmblem tier="Master" division="I" animate />);
    expect(container.querySelector('[class*="animate-"]')).toBeNull();
  });

  it('greys and fades a locked tier and draws its lock', () => {
    const { container } = render(<RankEmblem tier="Elite" division="III" locked />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toMatch(/grayscale/);
    expect(container.querySelectorAll('rect')).toHaveLength(1);
  });

  it('gives every tier its own silhouette', () => {
    const shapes = new Set(
      (['Initiate', 'Explorer', 'Challenger', 'Achiever', 'Veteran', 'Elite', 'Master', 'Legend'] as const).map((tier) => {
        const { container, unmount } = render(<RankEmblem tier={tier} division="I" />);
        const d = [...container.querySelectorAll('path')].find((p) => p.getAttribute('stroke-width') === '2.6')?.getAttribute('d');
        unmount();
        return d;
      }),
    );
    expect(shapes.size).toBe(8);
  });
});

describe('RankJourney (#13)', () => {
  it('shows the current rank, progress and a labelled estimate of the load still needed', () => {
    render(<RankJourney exerciseName="Bench press" view={view()} />);
    const hero = screen.getByRole('region', { name: 'Your rank' });
    expect(within(hero).getByText('Achiever II')).toBeTruthy();
    expect(within(hero).getByText('Bench press')).toBeTruthy();
    expect(within(hero).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('700');
    expect(within(hero).getByText(/1\.27× now · next division at 1\.30× body weight/)).toBeTruthy();
    expect(within(hero).getByText(/About 2\.4 kg more on your estimated one-rep max/)).toBeTruthy();
    expect(within(hero).getByText('est')).toBeTruthy();
  });

  it('lists every tier with its III · II · I thresholds, Legend first', () => {
    render(<RankJourney exerciseName="Bench press" view={view()} />);
    const rungs = screen.getAllByRole('listitem');
    expect(rungs[0].textContent).toMatch(/^Legend2\.15× · 2\.23× · 2\.32×.*Locked$/);
    expect(rungs[4].textContent).toMatch(/Achiever1\.10× · 1\.20× · 1\.30×You · II/);
    expect(rungs[7].textContent).toMatch(/Initiate.*Reached/);
  });

  it('shows the tiers alone, without thresholds or states, when opened without an exercise', () => {
    render(<RankJourney />);
    expect(screen.queryByRole('region', { name: 'Your rank' })).toBeNull();
    const rungs = screen.getAllByRole('listitem');
    expect(rungs).toHaveLength(8);
    expect(rungs.every((rung) => !/Locked|Reached|×/.test(rung.textContent ?? ''))).toBe(true);
    expect(screen.getByText(/open an exercise’s Rank tab/)).toBeTruthy();
    expect(screen.queryByText(/Tournaments/)).toBeNull();
  });

  it('counts reps for a reps standard and says when the top is reached', () => {
    const reps = view({
      benchmark: { version: 'v1', draft: false, method: 'reps', standards: 'men', tierStarts: [0, 5, 12, 22, 30, 40, 55, 75], basis: 'v1' },
      current: position({ milestone: 9, tier: 'Achiever', division: 'III', score: 23, nextScore: 25, basis: { setId: 's', sessionId: 'w', day: '2026-11-10', reps: 23 } }),
    });
    const { rerender } = render(<RankJourney view={reps} />);
    expect(screen.getByText('2 more reps in one set')).toBeTruthy();
    rerender(<RankJourney view={view({ current: position({ milestone: 23, tier: 'Legend', division: 'I', nextScore: undefined }) })} />);
    expect(screen.getByText('The top division.')).toBeTruthy();
  });
});
