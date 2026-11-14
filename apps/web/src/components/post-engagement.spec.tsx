import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FoodPost } from '@life-portal/shared-types';
import { PostEngagement } from './post-engagement';
import { api } from '../lib/api';
import { socialWrites } from '../lib/social-offline';
import { PostAudienceControl } from './post-header-controls';
import { shareHeads } from './post-share-sheet';
const stats = {
  data: { liked: false, likeCount: 0, commentCount: 0 },
  mutate: jest.fn(),
  isLoading: false,
};
const comments = {
  data: { comments: [] },
  mutate: jest.fn(),
  isLoading: false,
};
jest.mock('../lib/hooks', () => ({
  useApi: (url: string | null) =>
    url === null ? { data: undefined } : url.endsWith('/engagement') ? stats : comments,
  revalidate: jest.fn(),
}));
jest.mock('../lib/social-hooks', () => ({
  useSocialApi: () => ({ data: { people: [] }, isLoading: false }),
}));
jest.mock('../lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'reader' } }),
}));
jest.mock('../lib/social-offline', () => ({
  socialWrites: {
    toggle: jest.fn(async () => undefined),
    comment: jest.fn(async () => 'c'.repeat(24)),
    removeComment: jest.fn(async () => undefined),
  },
  useSocialWrites: () => [],
  useOffline: () => false,
}));
jest.mock('../lib/api', () => ({
  api: { put: jest.fn(), delete: jest.fn(), post: jest.fn(), patch: jest.fn() },
  NetworkError: class NetworkError extends Error {},
}));
const post = { id: 'post', title: 'Oats', audience: 'friends' } as FoodPost;
beforeEach(() => {
  jest.clearAllMocks();
  stats.data = { liked: false, likeCount: 0, commentCount: 0 };
  stats.mutate.mockImplementation(async (data) => {
    if (data) stats.data = data;
  });
  comments.mutate.mockResolvedValue(undefined);
});
it('queues a like and shows it as not sent yet', async () => {
  const view = render(<PostEngagement post={post} />);
  fireEvent.click(screen.getByRole('button', { name: 'Like' }));
  await waitFor(() =>
    expect(socialWrites.toggle).toHaveBeenCalledWith('like', 'post', true, 'Oats'),
  );
  expect(api.put).not.toHaveBeenCalled();
  view.unmount();
});
it('queues a comment with the text and clears the draft', async () => {
  const view = render(<PostEngagement post={post} />);
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  fireEvent.change(screen.getByLabelText('Write a comment'), {
    target: { value: 'Hello' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await waitFor(() =>
    expect(socialWrites.comment).toHaveBeenCalledWith('post', 'Hello'),
  );
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Write a comment') as HTMLTextAreaElement).value,
    ).toBe(''),
  );
  expect(api.post).not.toHaveBeenCalled();
  view.unmount();
});
it('copies a permission-preserving post link when native sharing is unavailable', async () => {
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: undefined,
  });
  const writeText = jest.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const view = render(<PostEngagement post={post} />);
  expect(screen.getAllByRole('button').length).toBe(3);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(screen.queryByRole('button', { name: 'More…' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  await screen.findByText('Link copied. The post’s audience still applies.');
  expect(writeText).toHaveBeenCalledWith(
    new URL('/posts/post', window.location.origin).href,
  );
  expect(api.patch).not.toHaveBeenCalled();
  view.unmount();
});
it('changes only the audience without overwriting the caption', async () => {
  (api.patch as jest.Mock).mockResolvedValue({ audience: 'public' });
  const view = render(
    <PostAudienceControl id="post" audience="private" isOwner />,
  );
  fireEvent.change(screen.getByLabelText('Change post audience'), {
    target: { value: 'public' },
  });
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('/posts/post/audience', {
      audience: 'public',
    }),
  );
  view.unmount();
});

it('lists recent chats first, then friends without a conversation, once each', () => {
  const person = (userId: string, displayName: string) =>
    ({ userId, displayName, username: userId }) as never;
  expect(
    shareHeads(
      [{ id: 'c1', other: person('b', 'Bea'), preview: '', lastMessageAt: '', unread: 0 }],
      [person('a', 'Ana'), person('b', 'Bea')],
    ),
  ).toEqual([
    { userId: 'b', displayName: 'Bea', conversationId: 'c1' },
    { userId: 'a', displayName: 'Ana' },
  ]);
});
