import { bottomShift, topShift } from './viewport-drift';

describe('viewport drift', () => {
  it('is nothing when what is on screen is the layout viewport', () => {
    expect(bottomShift({ offsetTop: 0, height: 956 }, 956, false)).toBe(0);
    expect(topShift({ offsetTop: 0 }, false)).toBe(0);
    // Rounding noise is not drift.
    expect(bottomShift({ offsetTop: 0.4, height: 956.3 }, 956, false)).toBe(0);
  });

  it('moves the bar and the header down by how far the screen has drifted', () => {
    // The visual viewport is stuck 250px down the layout viewport: both edges are 250px off.
    expect(bottomShift({ offsetTop: 250, height: 956 }, 956, false)).toBe(250);
    expect(topShift({ offsetTop: 250 }, false)).toBe(250);
  });

  it('follows a layout viewport that is taller than the screen', () => {
    expect(bottomShift({ offsetTop: 0, height: 700 }, 956, false)).toBe(-256);
  });

  it('leaves everything alone while a field has focus: the difference is the keyboard', () => {
    expect(bottomShift({ offsetTop: 0, height: 620 }, 956, true)).toBe(0);
    expect(topShift({ offsetTop: 120 }, true)).toBe(0);
  });
});
