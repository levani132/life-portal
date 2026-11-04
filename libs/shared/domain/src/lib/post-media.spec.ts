import {
  clampAspect,
  fitWithin,
  macroShares,
  newFoodActions,
  mediaLimitError,
  mediaListError,
  postHasContent,
} from './post-media';

const photo = { kind: 'image' as const, contentType: 'image/jpeg', bytes: 500_000, width: 2048, height: 1536 };
const video = {
  kind: 'video' as const,
  contentType: 'video/mp4',
  bytes: 9_000_000,
  width: 720,
  height: 1280,
  durationMs: 30_000,
  poster: { bytes: 80_000 },
};

describe('postHasContent', () => {
  it('accepts text, media or food alone', () => {
    expect(postHasContent({ caption: 'Back from the gym' })).toBe(true);
    expect(postHasContent({ title: 'Hi' })).toBe(true);
    expect(postHasContent({ mediaCount: 1 })).toBe(true);
    expect(postHasContent({ hasFood: true })).toBe(true);
  });
  it('refuses an empty post, whitespace included', () => {
    expect(postHasContent({ title: ' ', caption: '\n', mediaCount: 0 })).toBe(false);
  });
});

describe('mediaLimitError', () => {
  it('accepts a JPEG photo and a 30 s video with a still', () => {
    expect(mediaLimitError(photo)).toBeNull();
    expect(mediaLimitError(video)).toBeNull();
  });
  it('allows the recorder a little past 30 s, not more', () => {
    expect(mediaLimitError({ ...video, durationMs: 30_400 })).toBeNull();
    expect(mediaLimitError({ ...video, durationMs: 31_000 })).toMatch(/30 seconds/);
  });
  it('refuses wrong types, sizes and shapes', () => {
    expect(mediaLimitError({ ...photo, contentType: 'image/png' })).toMatch(/JPEG/);
    expect(mediaLimitError({ ...photo, bytes: 16 * 1024 * 1024 })).toMatch(/too large/);
    expect(mediaLimitError({ ...photo, width: 0 })).toMatch(/size/);
    expect(mediaLimitError({ ...video, poster: undefined })).toMatch(/still/);
    expect(mediaLimitError({ ...photo, durationMs: 1000 })).toMatch(/no duration/);
    expect(mediaLimitError({ ...video, contentType: 'video/avi' })).toMatch(/MP4/);
  });
});

describe('mediaListError', () => {
  it('limits a post to 10 distinct items', () => {
    expect(mediaListError(['a', 'b'])).toBeNull();
    expect(mediaListError(Array.from({ length: 11 }, (_, i) => `${i}`))).toMatch(/at most 10/);
    expect(mediaListError(['a', 'a'])).toMatch(/twice/);
  });
});

describe('clampAspect and fitWithin', () => {
  it('clamps between 4:5 and 1.91:1', () => {
    expect(clampAspect(1080, 1920)).toBe(0.8);
    expect(clampAspect(4000, 1000)).toBe(1.91);
    expect(clampAspect(1200, 1000)).toBeCloseTo(1.2);
    expect(clampAspect(0, 10)).toBe(1);
  });
  it('shrinks to the long edge and never enlarges', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });
});

describe('macroShares', () => {
  it('splits calories by 4/4/9 and adds up to one', () => {
    const shares = macroShares({ proteinMg: 30_000, carbMg: 50_000, fatMg: 20_000 });
    // 120 + 200 + 180 = 500 kcal from macros
    expect(shares.protein).toBeCloseTo(0.24);
    expect(shares.carbs).toBeCloseTo(0.4);
    expect(shares.fat).toBeCloseTo(0.36);
  });
  it('is all zero without macros', () => {
    expect(macroShares({ proteinMg: 0, carbMg: 0, fatMg: 0 })).toEqual({ protein: 0, carbs: 0, fat: 0 });
  });
});

describe('newFoodActions', () => {
  it('follows the save and log checkboxes', () => {
    expect(newFoodActions({ save: true, log: false })).toEqual({ canLog: true, log: false, keep: 'Save food', post: 'Save and Post' });
    expect(newFoodActions({ save: true, log: true })).toEqual({ canLog: true, log: true, keep: 'Save and log food', post: 'Save, Log and Post' });
  });
  it('never logs without saving', () => {
    expect(newFoodActions({ save: false, log: true })).toEqual({ canLog: false, log: false, post: 'Post' });
  });
});
