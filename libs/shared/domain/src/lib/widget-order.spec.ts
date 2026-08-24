import { arrangeWidgets, moveWidget } from './widget-order';

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
