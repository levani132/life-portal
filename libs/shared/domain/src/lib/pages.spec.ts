import { followingAuthors, mayCreatePage, mayRemoveManager, nextOwner, pageAccess, pageHasNoActiveManager, pageLimitFor, pageOwner, pagesRemaining } from './pages';

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
  const managers = ['owner', 'b', 'c'];
  it('lets a manager leave and the owner remove anyone, but never the owner or the last one', () => {
    expect(mayRemoveManager({ requester: 'b', target: 'b', managers, owner: 'owner' })).toBe(true);
    expect(mayRemoveManager({ requester: 'owner', target: 'c', managers, owner: 'owner' })).toBe(true);
    expect(mayRemoveManager({ requester: 'b', target: 'c', managers, owner: 'owner' })).toBe(false);
    expect(mayRemoveManager({ requester: 'b', target: 'owner', managers, owner: 'owner' })).toBe(false);
    // The owner hands over first: they cannot simply leave.
    expect(mayRemoveManager({ requester: 'owner', target: 'owner', managers, owner: 'owner' })).toBe(false);
    expect(mayRemoveManager({ requester: 'b', target: 'b', managers: ['b'], owner: 'b' })).toBe(false);
    expect(mayRemoveManager({ requester: 'x', target: 'b', managers, owner: 'owner' })).toBe(false);
    expect(mayRemoveManager({ requester: 'owner', target: 'x', managers, owner: 'owner' })).toBe(false);
  });
  it('lets any manager remove others when there is no owner', () => {
    expect(mayRemoveManager({ requester: 'b', target: 'c', managers: ['b', 'c'] })).toBe(true);
  });
  it('finds the owner: handed over, else the creator, while they still manage it', () => {
    expect(pageOwner({ createdBy: 'a', managers: ['a', 'b'] })).toBe('a');
    expect(pageOwner({ createdBy: 'a', ownerId: 'b', managers: ['a', 'b'] })).toBe('b');
    expect(pageOwner({ createdBy: 'a', managers: ['b'] })).toBeUndefined();
  });
  it('passes ownership to the longest-serving other manager', () => {
    expect(nextOwner(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextOwner(['a'], 'a')).toBeUndefined();
  });
  it('suspends a page only when every manager is suspended', () => {
    expect(pageHasNoActiveManager(['a', 'b'], new Set(['a']))).toBe(false);
    expect(pageHasNoActiveManager(['a', 'b'], new Set(['a', 'b']))).toBe(true);
    expect(pageHasNoActiveManager([], new Set(['a']))).toBe(false);
  });
});
