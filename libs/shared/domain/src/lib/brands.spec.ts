import { brandKey, cleanBrandName, topBrandKeys } from './brands';

describe('brandKey', () => {
  it('is the same for spellings of one brand', () => {
    for (const spelling of ["McDonald's", 'mcdonalds', 'Mc Donalds', 'MCDONALD’S', ' mc-donalds ']) expect(brandKey(spelling)).toBe('mcdonalds');
    expect(brandKey('Nestlé')).toBe(brandKey('nestle'));
    expect(brandKey('Coca-Cola')).toBe('cocacola');
  });

  it('keeps letters of other scripts, and is empty with nothing to keep', () => {
    expect(brandKey('ბარამბო')).toBe('ბარამბო');
    expect(brandKey(' -- ')).toBe('');
    expect(brandKey(undefined)).toBe('');
  });
});

describe('cleanBrandName', () => {
  it('trims and collapses spaces', () => {
    expect(cleanBrandName('  Burger   King ')).toBe('Burger King');
  });
});

describe('topBrandKeys', () => {
  const foods = [
    { brand: "McDonald's", useCount: 4 },
    { brand: 'mcdonalds', useCount: 3 },
    { brand: 'KFC', useCount: 5 },
    { brand: 'Lidl', useCount: 0 },
    { brand: 'Lidl', useCount: 0 },
    { brand: 'Aldi', useCount: 0 },
    { brand: 'Subway', useCount: 9, archived: true },
    { useCount: 50 },
  ];

  it('ranks by times eaten across every spelling, then by number of foods, then by name', () => {
    expect(topBrandKeys(foods)).toEqual(['mcdonalds', 'kfc', 'lidl', 'aldi']);
  });

  it('keeps to the limit', () => {
    expect(topBrandKeys(foods, 2)).toEqual(['mcdonalds', 'kfc']);
    expect(topBrandKeys(foods, 0)).toEqual([]);
  });
});
