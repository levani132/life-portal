import { mayCreatePage, pageAccess, pageLimitFor, pagesRemaining } from './pages';

describe('pages rules (spec 040)', () => {
  it('gives a page everything social and the two libraries, and nothing personal', () => {
    const access = pageAccess();
    for (const on of ['social', 'foodPosts', 'postMedia', 'forYou', 'nutrition', 'training', 'trainingPosts'] as const) expect(access[on]).toBe(true);
    for (const off of ['messages', 'money', 'stocks', 'loans', 'items', 'personal', 'projects', 'epam', 'trainingLevels', 'trainingRanks', 'tournaments', 'forYouMetrics', 'pages'] as const) expect(access[off]).toBe(false);
  });

  it('limits a person to three pages unless the owner says otherwise, and never the developer', () => {
    expect(pageLimitFor({ developer: false })).toBe(3);
    expect(pageLimitFor({ developer: false, pageLimit: 20 })).toBe(20);
    expect(pageLimitFor({ developer: false, pageLimit: 0 })).toBe(0);
    expect(pageLimitFor({ developer: false, pageLimit: -1 })).toBeNull();
    expect(pageLimitFor({ developer: true, pageLimit: 0 })).toBeNull();
    expect(pageLimitFor({ developer: false, pageLimit: -7 })).toBe(3);

    expect(mayCreatePage({ developer: false, created: 2 })).toBe(true);
    expect(mayCreatePage({ developer: false, created: 3 })).toBe(false);
    expect(mayCreatePage({ developer: false, created: 3, pageLimit: 4 })).toBe(true);
    expect(mayCreatePage({ developer: true, created: 500 })).toBe(true);
    // A limit lowered below what someone already has leaves them at zero, not negative.
    expect(pagesRemaining({ developer: false, created: 5, pageLimit: 2 })).toBe(0);
    expect(pagesRemaining({ developer: false, created: 1, pageLimit: -1 })).toBeNull();
  });
});
