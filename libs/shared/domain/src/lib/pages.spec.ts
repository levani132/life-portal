import { followingAuthors, mayCreatePage, mayRemoveManager, pageAccess, pageHasNoActiveManager, pageLimitFor, pagesRemaining } from './pages';

describe('pages rules (spec 040)', () => {
  it('gives a page everything social and the two libraries, and nothing personal', () => {
    const access = pageAccess();
    for (const on of ['social', 'messages', 'foodPosts', 'postMedia', 'forYou', 'nutrition', 'training', 'trainingPosts'] as const) expect(access[on]).toBe(true);
    for (const off of ['money', 'stocks', 'loans', 'items', 'personal', 'projects', 'epam', 'trainingLevels', 'trainingRanks', 'tournaments', 'forYouMetrics', 'pages'] as const) expect(access[off]).toBe(false);
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

describe('followingAuthors', () => {
  it('holds yourself, your friends and the pages you follow', () => {
    expect(followingAuthors({ self: 'me', friends: ['f1', 'f2'], followedPages: ['p1'] })).toEqual(['me', 'f1', 'f2', 'p1']);
  });
  it('names nobody twice, and is just you when you follow nobody', () => {
    expect(followingAuthors({ self: 'me', friends: ['f1'], followedPages: ['f1', 'me'] })).toEqual(['me', 'f1']);
    expect(followingAuthors({ self: 'me', friends: [], followedPages: [] })).toEqual(['me']);
  });
});

describe('co-managers (spec 045)', () => {
  const managers = ['creator', 'b', 'c'];
  it('lets anyone leave, the creator remove anyone, and nobody remove the last manager', () => {
    expect(mayRemoveManager({ requester: 'b', target: 'b', managers, createdBy: 'creator' })).toBe(true);
    expect(mayRemoveManager({ requester: 'creator', target: 'c', managers, createdBy: 'creator' })).toBe(true);
    expect(mayRemoveManager({ requester: 'b', target: 'c', managers, createdBy: 'creator' })).toBe(false);
    expect(mayRemoveManager({ requester: 'b', target: 'creator', managers, createdBy: 'creator' })).toBe(false);
    expect(mayRemoveManager({ requester: 'creator', target: 'creator', managers: ['creator'], createdBy: 'creator' })).toBe(false);
    expect(mayRemoveManager({ requester: 'x', target: 'b', managers, createdBy: 'creator' })).toBe(false);
    expect(mayRemoveManager({ requester: 'creator', target: 'x', managers, createdBy: 'creator' })).toBe(false);
  });
  it('lets any manager remove others once the creator has left', () => {
    expect(mayRemoveManager({ requester: 'b', target: 'c', managers: ['b', 'c'], createdBy: 'creator' })).toBe(true);
    expect(mayRemoveManager({ requester: 'b', target: 'c', managers: ['b', 'c'] })).toBe(true);
  });
  it('suspends a page only when every manager is suspended', () => {
    expect(pageHasNoActiveManager(['a', 'b'], new Set(['a']))).toBe(false);
    expect(pageHasNoActiveManager(['a', 'b'], new Set(['a', 'b']))).toBe(true);
    expect(pageHasNoActiveManager([], new Set(['a']))).toBe(false);
  });
});
