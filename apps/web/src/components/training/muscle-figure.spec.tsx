import { render } from '@testing-library/react';
import { MUSCLES } from '@life-portal/shared-types';
import { MuscleFigure, hasMuscleFigure } from './muscle-figure';
import { RankEmblem } from './rank-emblem';

describe('muscle figures', () => {
  it.each(MUSCLES)('has a panel that lights %s', (muscle) => {
    expect(hasMuscleFigure([muscle])).toBe(true);
    const { container } = render(<MuscleFigure muscles={[muscle]} lit="red" dim="grey" gap="black" />);
    expect(container.querySelector(`[data-muscle-figure="${muscle}"]`)).toBeTruthy();
    expect(container.querySelectorAll('[data-lit]').length).toBeGreaterThan(0);
  });

  it('lights every listed muscle on the main muscle\'s panel, and has no figure without a muscle', () => {
    const one = render(<MuscleFigure muscles={['chest']} lit="red" dim="grey" gap="black" />);
    const two = render(<MuscleFigure muscles={['chest', 'shoulders', 'triceps']} lit="red" dim="grey" gap="black" />);
    expect(two.container.querySelectorAll('[data-lit]').length).toBeGreaterThan(one.container.querySelectorAll('[data-lit]').length);
    expect(hasMuscleFigure([])).toBe(false);
    expect(hasMuscleFigure(undefined)).toBe(false);
  });

  it('puts the figure inside a rank emblem in place of the glyph, keeping the pips', () => {
    const plain = render(<RankEmblem tier="Achiever" division="II" />);
    expect(plain.container.querySelector('[data-muscle-figure]')).toBeNull();
    const withMuscle = render(<RankEmblem tier="Achiever" division="II" muscles={['quadriceps']} />);
    expect(withMuscle.container.querySelector('[data-muscle-figure="quadriceps"]')).toBeTruthy();
    expect(withMuscle.container.querySelectorAll('[data-pip="on"]')).toHaveLength(2);
    // No muscle (cardio, or none listed): the glyph stays.
    const none = render(<RankEmblem tier="Achiever" division="II" muscles={[]} />);
    expect(none.container.querySelector('[data-muscle-figure]')).toBeNull();
  });
});
