import { bottomShift, topShift } from './viewport-drift';

describe('viewport drift', () => {
  it('is nothing when the screen sits at the top of the page', () => {
    expect(bottomShift({ offsetTop: 0 }, false)).toBe(0);
    expect(topShift({ offsetTop: 0 }, false)).toBe(0);
    // Rounding noise is not drift.
    expect(bottomShift({ offsetTop: 0.4 }, false)).toBe(0);
    expect(topShift({ offsetTop: 1.4 }, false)).toBe(0);
  });

  it('moves the bar and the header down by how far the screen has slid down the page', () => {
    expect(bottomShift({ offsetTop: 250 }, false)).toBe(250);
    expect(topShift({ offsetTop: 250 }, false)).toBe(250);
  });

  it('gives the bar and the header the same shift whatever height iOS reports', () => {
    // The phantom keyboard after reopening the app: iOS reports a short screen with no keyboard
    // showing, and the screen slides between 0 and the keyboard's height as the page scrolls.
    for (const offsetTop of [0, 120, 336]) expect(bottomShift({ offsetTop }, false)).toBe(topShift({ offsetTop }, false));
  });

  it('never moves anything up', () => {
    expect(bottomShift({ offsetTop: -40 }, false)).toBe(0);
    expect(topShift({ offsetTop: -40 }, false)).toBe(0);
  });

  it('leaves everything alone while a field has focus: the keyboard is really up', () => {
    expect(bottomShift({ offsetTop: 120 }, true)).toBe(0);
    expect(topShift({ offsetTop: 120 }, true)).toBe(0);
  });
});
