import type { FoodPost } from '@life-portal/shared-types';
import { keptOwnPage, keptOwnPost, keptOwnProfile } from './own-posts';

const store = new Map<string, unknown>();
const cache = {
  put: jest.fn(async (key: string, value: unknown) => void store.set(key, value)),
  get: jest.fn(async (key: string) => store.get(key)),
  remove: jest.fn(async (key: string) => void store.delete(key)),
};
const get = jest.fn();

jest.mock('../api', () => {
  const actual = jest.requireActual('../api');
  return { ...actual, api: { get: (path: string) => get(path) } };
});
jest.mock('./runtime', () => ({ waitForOfflineCache: async () => cache }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getWithOfflineCopy } = require('./reads') as typeof import('./reads');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ApiError, NetworkError } = require('../api') as typeof import('../api');

const post = (id: string, over: Partial<FoodPost> = {}) => ({ id, title: id, isOwner: true, media: [], ...over }) as FoodPost;
const ID = 'a'.repeat(24);
const ME = 'b'.repeat(24);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe('own posts kept for reading offline (spec 033)', () => {
  it('keeps only the person’s own posts, never another person’s or a repost of one', () => {
    expect(keptOwnPost(post('mine'))).toMatchObject({ id: 'mine' });
    expect(keptOwnPost(post('theirs', { isOwner: false }))).toBeUndefined();
    expect(keptOwnPost(post('shared', { repost: { id: 'r', by: {} as never, isMine: true, createdAt: '' } }))).toBeUndefined();
    expect(keptOwnPage({ posts: [post('mine'), post('theirs', { isOwner: false })], nextCursor: 'c' })).toEqual({
      posts: [post('mine')],
    });
    expect(keptOwnPage({ posts: [post('theirs', { isOwner: false })] })).toBeUndefined();
  });

  it('answers an own post from the device with no connection', async () => {
    get.mockResolvedValueOnce(post(ID));
    await getWithOfflineCopy(`/posts/${ID}`);
    await flush();
    get.mockRejectedValueOnce(new NetworkError());
    await expect(getWithOfflineCopy(`/posts/${ID}`)).resolves.toMatchObject({ id: ID });
  });

  it('never keeps another person’s post, and forgets a kept one the server refuses', async () => {
    get.mockResolvedValueOnce(post(ID, { isOwner: false }));
    await getWithOfflineCopy(`/posts/${ID}`);
    await flush();
    expect(store.size).toBe(0);

    get.mockResolvedValueOnce(post(ID));
    await getWithOfflineCopy(`/posts/${ID}`);
    await flush();
    get.mockRejectedValueOnce(new ApiError('Post not found.', 404, undefined, 'POST_GONE'));
    await expect(getWithOfflineCopy(`/posts/${ID}`)).rejects.toBeInstanceOf(ApiError);
    await flush();
    expect(store.size).toBe(0);
    get.mockRejectedValueOnce(new NetworkError());
    await expect(getWithOfflineCopy(`/posts/${ID}`)).rejects.toBeInstanceOf(NetworkError);
  });

  it('keeps the first page of the person’s own profile, and drops it when none are left', async () => {
    const path = `/posts?authorId=${ME}&preview=self`;
    get.mockResolvedValueOnce({ posts: [post('one'), post('theirs', { isOwner: false })], nextCursor: 'c' });
    await getWithOfflineCopy(path);
    await flush();
    expect([...store.values()]).toEqual([{ posts: [post('one')] }]);
    get.mockResolvedValueOnce({ posts: [] });
    await getWithOfflineCopy(path);
    await flush();
    expect(store.size).toBe(0);
    expect(cache.put).toHaveBeenCalledTimes(1);
    // The Wall and other feeds are never kept.
    get.mockResolvedValueOnce({ posts: [post('one')] });
    await getWithOfflineCopy('/posts?preview=self');
    await flush();
    expect(store.size).toBe(0);
  });

  it('keeps the own profile header without its shared widgets, which can show money', async () => {
    const profile = { userId: ME, username: 'me', displayName: 'Me', bio: '', relationship: 'self', muted: false, friendCount: 2, widgets: [{ module: 'cashflow' }] } as never;
    expect(keptOwnProfile(profile)).toEqual({ userId: ME, username: 'me', displayName: 'Me', bio: '', relationship: 'self', muted: false, friendCount: 2, widgets: [] });
    get.mockResolvedValueOnce(profile);
    await getWithOfflineCopy('/social/me?preview=normal&today=2026-11-14');
    await flush();
    expect(store.get('social:me:normal')).toMatchObject({ widgets: [] });
    get.mockRejectedValueOnce(new NetworkError());
    await expect(getWithOfflineCopy('/social/me?preview=normal&today=2026-11-15')).resolves.toMatchObject({ displayName: 'Me', widgets: [] });
  });
});
