import { canShareImage, macroLine, ringArcs, shareTargetUrl } from './share-out';

describe('canShareImage', () => {
  it('allows your own posts and public ones, never another member’s friends or private post', () => {
    expect(canShareImage({ own: true, audience: 'private' })).toBe(true);
    expect(canShareImage({ own: false, audience: 'public' })).toBe(true);
    expect(canShareImage({ own: false, audience: 'friends' })).toBe(false);
    expect(canShareImage({ own: false, audience: 'private' })).toBe(false);
  });
});

describe('ringArcs', () => {
  it('splits the circle by calorie share, with gaps between parts', () => {
    // 10 g protein (40 kcal), 10 g carbs (40 kcal), 0 fat → two halves.
    const arcs = ringArcs({ proteinMg: 10000, carbMg: 10000, fatMg: 0 });
    expect(arcs.map((a) => a.key)).toEqual(['protein', 'carbs']);
    expect(arcs[0].start).toBe(0);
    expect(arcs[0].end).toBeCloseTo(0.492);
    expect(arcs[1].start).toBeCloseTo(0.5);
    expect(arcs[1].end).toBeCloseTo(0.992);
  });
  it('draws a single part as a full circle, and nothing when there are no macros', () => {
    expect(ringArcs({ proteinMg: 0, carbMg: 0, fatMg: 5000 })).toEqual([
      { key: 'fat', start: 0, end: 1 },
    ]);
    expect(ringArcs({ proteinMg: 0, carbMg: 0, fatMg: 0 })).toEqual([]);
  });
});

describe('shareTargetUrl', () => {
  const url = 'https://app.example/posts/abc';
  it('sends only the encoded link and text', () => {
    expect(shareTargetUrl('whatsapp', url, 'Lobiani')).toBe(
      'https://wa.me/?text=Lobiani%20https%3A%2F%2Fapp.example%2Fposts%2Fabc',
    );
    expect(shareTargetUrl('facebook', url, 'ignored')).toBe(
      'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fapp.example%2Fposts%2Fabc',
    );
    expect(shareTargetUrl('messenger', url, '')).toBe(
      'fb-messenger://share/?link=https%3A%2F%2Fapp.example%2Fposts%2Fabc',
    );
    expect(shareTargetUrl('x', url, 'A & B')).toBe(
      'https://x.com/intent/post?url=https%3A%2F%2Fapp.example%2Fposts%2Fabc&text=A%20%26%20B',
    );
  });
});

describe('macroLine', () => {
  it('rounds to whole numbers and is empty without macros', () => {
    expect(macroLine({ energyKcal: 1520.4, proteinG: 18.4, carbG: 70.5, fatG: 16 })).toBe(
      '1,520 kcal · P 18g · C 71g · F 16g',
    );
    expect(macroLine(undefined)).toBe('');
  });
});
