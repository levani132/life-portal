import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FoodPost } from '@life-portal/shared-types';
import { PostEngagement } from './post-engagement';
import { api } from '../lib/api';
import { PostAudienceControl } from './post-header-controls';
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
  useApi: (url: string) => (url.endsWith('/engagement') ? stats : comments),
  revalidate: jest.fn(),
}));
jest.mock('../lib/api', () => ({
  api: { put: jest.fn(), delete: jest.fn(), post: jest.fn(), patch: jest.fn() },
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
it('saves a like and rolls back an unsuccessful unlike', async () => {
  (api.put as jest.Mock).mockResolvedValue({
    liked: true,
    likeCount: 1,
    commentCount: 0,
  });
  (api.delete as jest.Mock).mockRejectedValue(new Error('Connection failed'));
  const view = render(<PostEngagement post={post} />);
  fireEvent.click(screen.getByRole('button', { name: 'Like' }));
  await waitFor(() => expect(screen.getByText('1 like')).toBeTruthy());
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Like' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Like' }));
  await screen.findByText('Connection failed');
  expect(
    screen.getByRole('button', { name: 'Like' }).getAttribute('aria-pressed'),
  ).toBe('true');
  expect(screen.getByText('1 like')).toBeTruthy();
  view.unmount();
});
it('preserves a failed comment draft and reuses its request ID on retry', async () => {
  (api.post as jest.Mock)
    .mockRejectedValueOnce(new Error('Connection failed'))
    .mockResolvedValueOnce({
      id: 'a'.repeat(24),
      text: 'Hello',
      author: { userId: 'reader', displayName: 'Reader', username: 'reader' },
      createdAt: '2026-11-02T00:00:00Z',
      canDelete: true,
    });
  const view = render(<PostEngagement post={post} />);
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  fireEvent.change(screen.getByLabelText('Write a comment'), {
    target: { value: 'Hello' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await screen.findByText('Connection failed');
  expect(
    (screen.getByLabelText('Write a comment') as HTMLTextAreaElement).value,
  ).toBe('Hello');
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await screen.findByText('Hello');
  expect((api.post as jest.Mock).mock.calls[0][1].requestId).toBe(
    (api.post as jest.Mock).mock.calls[1][1].requestId,
  );
  expect(
    (screen.getByLabelText('Write a comment') as HTMLTextAreaElement).value,
  ).toBe('');
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
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
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
