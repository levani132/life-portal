import { WIDGET_SIZES_MAX, arrangeWidgets, isPortalSize, moveWidget, portalSize, sizeWidgets, withWidgetSize } from './widget-order';

const cards = [
  { id: 'loans', order: 1 },
  { id: 'cashflow', order: 2 },
  { id: 'items', order: 3 },
  { id: 'board:epam', order: 10 },
  { id: 'nutrition', order: 25 },
];

describe('arrangeWidgets', () => {
  it('falls back to the widgets own order when nothing is arranged', () => {
    expect(arrangeWidgets(cards, undefined).map((c) => c.id)).toEqual([
      'loans',
      'cashflow',
      'items',
      'board:epam',
      'nutrition',
    ]);
    expect(arrangeWidgets(cards, []).map((c) => c.id)).toEqual(
      arrangeWidgets(cards, undefined).map((c) => c.id),
    );
  });

  it('puts arranged cards where the user put them', () => {
    const arranged = arrangeWidgets(cards, [
      'nutrition',
      'board:epam',
      'items',
      'cashflow',
      'loans',
    ]);
    expect(arranged.map((c) => c.id)).toEqual([
      'nutrition',
      'board:epam',
      'items',
      'cashflow',
      'loans',
    ]);
  });

  it('lands a card the user has never arranged after every arranged one', () => {
    // Only two cards were positioned; the other three are newcomers and keep their own
    // relative ranking behind them.
    expect(arrangeWidgets(cards, ['nutrition', 'items']).map((c) => c.id)).toEqual([
      'nutrition',
      'items',
      'loans',
      'cashflow',
      'board:epam',
    ]);
  });

  it('ignores arranged ids that no longer match a card', () => {
    // `board:gone` was deleted; the arrangement still applies to everything else and needs
    // no migration.
    expect(arrangeWidgets(cards, ['board:gone', 'nutrition', 'loans']).map((c) => c.id)).toEqual([
      'nutrition',
      'loans',
      'cashflow',
      'items',
      'board:epam',
    ]);
  });

  it('survives a duplicated id by honouring its first mention', () => {
    expect(arrangeWidgets(cards, ['items', 'loans', 'items']).map((c) => c.id)).toEqual([
      'items',
      'loans',
      'cashflow',
      'board:epam',
      'nutrition',
    ]);
  });

  it('does not mutate the array it was given', () => {
    const input = [...cards];
    arrangeWidgets(input, ['nutrition']);
    expect(input.map((c) => c.id)).toEqual(cards.map((c) => c.id));
  });
});

describe('moveWidget', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves an id later, closing the gap behind it', () => {
    expect(moveWidget(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an id earlier', () => {
    expect(moveWidget(ids, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves to the end', () => {
    expect(moveWidget(ids, 1, 3)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('returns a copy for a no-op or an impossible index', () => {
    expect(moveWidget(ids, 2, 2)).toEqual(ids);
    expect(moveWidget(ids, 9, 0)).toEqual(ids);
    expect(moveWidget(ids, -1, 0)).toEqual(ids);
    expect(moveWidget(ids, 2, 2)).not.toBe(ids);
  });

  it('clamps a target index past either end', () => {
    expect(moveWidget(ids, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveWidget(ids, 3, -5)).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('widget sizes', () => {
  const cards = [{ id: 'nutrition' }, { id: 'training' }, { id: 'board:epam' }];

  it('gives each card its chosen width, and wide when there is none or it is unknown', () => {
    const sized = sizeWidgets(cards, { nutrition: 'full', training: 'huge', 'board:gone': 'half' });
    expect(sized.map((card) => card.size)).toEqual(['full', 'wide', 'wide']);
    expect(sizeWidgets(cards, undefined).every((card) => card.size === 'wide')).toBe(true);
  });

  it('stores a choice, drops it again for the default, and forgets values it does not know', () => {
    expect(withWidgetSize(undefined, 'nutrition', 'half')).toEqual({ nutrition: 'half' });
    expect(withWidgetSize({ nutrition: 'half', training: 'full' }, 'nutrition', 'wide')).toEqual({ training: 'full' });
    expect(withWidgetSize({ old: 'huge', training: 'wide' }, 'nutrition', 'full')).toEqual({ nutrition: 'full' });
  });

  it('never keeps more than the cap', () => {
    const many = Object.fromEntries(Array.from({ length: WIDGET_SIZES_MAX + 5 }, (_, i) => [`c${i}`, 'half']));
    const next = withWidgetSize(many, 'new', 'full');
    expect(Object.keys(next)).toHaveLength(WIDGET_SIZES_MAX);
    expect(next['new']).toBe('full');
    expect(next['c0']).toBeUndefined();
  });
});

describe('portalSize (spec 046)', () => {
  it('reads squares, the old names, and falls back to the module default', () => {
    expect(portalSize('3x2', 'stocks')).toEqual({ w: 3, h: 2, size: '3x2' });
    expect(portalSize('large', 'nutrition')).toEqual({ w: 4, h: 4, size: '4x4' });
    expect(portalSize('small', 'stocks').size).toBe('2x2');
    expect(portalSize(undefined, 'nutrition').size).toBe('4x2');
    expect(portalSize('9x9', 'stocks').size).toBe('2x2');
  });
  it('keeps a one-square-wide widget one square tall', () => {
    expect(portalSize('1x3', 'stocks')).toEqual({ w: 1, h: 1, size: '1x1' });
    expect(isPortalSize('1x1')).toBe(true);
    expect(isPortalSize('1x2')).toBe(false);
    expect(isPortalSize('4x4')).toBe(true);
    expect(isPortalSize('large')).toBe(false);
  });
});
