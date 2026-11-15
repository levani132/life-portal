import { correction, floorHeight, pickAnchor, shortfall, stillVisible } from './scroll-anchor';

describe('scroll anchoring maths (#24)', () => {
  const cards = [
    { top: -400, bottom: -20 },
    { top: -10, bottom: 300 },
    { top: 316, bottom: 700 },
  ];

  it('anchors to the first card still on screen, not one scrolled past', () => {
    expect(pickAnchor(cards, 0, 812)).toBe(1);
  });

  it('has no anchor when nothing is on screen', () => {
    expect(pickAnchor(cards, 0, -500)).toBe(-1);
    expect(pickAnchor([], 0, 812)).toBe(-1);
  });

  it('keeps a touched card only while part of it shows', () => {
    expect(stillVisible({ top: 700, bottom: 900 }, 0, 812)).toBe(true);
    expect(stillVisible({ top: 820, bottom: 900 }, 0, 812)).toBe(false);
    expect(stillVisible({ top: -300, bottom: 0 }, 0, 812)).toBe(false);
  });

  it('scrolls by exactly how far the anchor moved, ignoring sub-pixel noise', () => {
    expect(correction(120, 180)).toBe(60); // something above grew: follow it down
    expect(correction(120, 40)).toBe(-80); // something above shrank: follow it up
    expect(correction(120, 120.6)).toBe(0);
  });

  it('floors the list so the page stays as tall as the current scroll needs', () => {
    // Scrolled to 1500 on an 812 viewport; list starts at 200 with 100 below it.
    expect(floorHeight(1500, 812, 200, 100)).toBe(2012);
    // At the top of the page nothing needs holding.
    expect(floorHeight(0, 812, 900, 100)).toBe(0);
  });

  it('asks for more page when following the anchor would scroll past the end', () => {
    // At the bottom of a 2689px page: following the anchor 44px down needs 44px more page.
    expect(shortfall(1877, 44, 812, 2689)).toBe(44);
    expect(shortfall(1000, 44, 812, 2689)).toBe(0);
    expect(shortfall(1877, -44, 812, 2689)).toBe(0);
  });
});
