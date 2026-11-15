import { entryScrollTarget } from './workout-entry-scroll';

describe('scrolling to the current exercise on entry (#32)', () => {
  it('places the card just under what sticks at the top', () => {
    // Card 900px down the viewport, header + rest timer cover 150px, 8px gap.
    expect(entryScrollTarget({ cardTop: 900, scrollY: 0, covered: 150 })).toBe(742);
  });

  it('scrolls up too, when the card is above the restored position', () => {
    expect(entryScrollTarget({ cardTop: -300, scrollY: 1000, covered: 150 })).toBe(542);
  });

  it('does nothing when the card is already there', () => {
    expect(entryScrollTarget({ cardTop: 160, scrollY: 400, covered: 150 })).toBeNull();
  });

  it('never asks for a scroll above the page', () => {
    expect(entryScrollTarget({ cardTop: 100, scrollY: 20, covered: 150 })).toBe(0);
  });
});
