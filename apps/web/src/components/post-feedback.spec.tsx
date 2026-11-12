import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PostPage } from '@life-portal/shared-types';
import { PostsList } from './posts';
import { api } from '../lib/api';

const pages: Record<string, { data?: PostPage }> = {};
jest.mock('../lib/hooks', () => ({
  ...jest.requireActual('../lib/hooks'),
  useApi: (url: string | null) => (url ? (pages[url] ?? { isLoading: true }) : { data: undefined }),
  revalidate: jest.fn(),
}));
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return { ...actual, api: { put: jest.fn(), delete: jest.fn(), post: jest.fn(), get: jest.fn() } };
});
jest.mock('./post-engagement', () => ({ PostEngagement: () => null }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));

const post = (id: string, title: string, author: string) =>
  ({
    id,
    title,
    caption: '',
    audience: 'public',
    author: { userId: author, displayName: author, username: author },
    createdAt: '2026-11-12T10:00:00Z',
    updatedAt: '2026-11-12T10:00:00Z',
    version: 1,
    media: [],
    isOwner: false,
    itemCount: 0,
    items: [],
  }) as never;

function openMenu(title: string) {
  const card = screen.getByText(title).closest('article, .card') as HTMLElement;
  const summary = card.querySelector('summary') as HTMLElement;
  fireEvent.click(summary);
  return card;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(pages)) delete pages[key];
  (api.put as jest.Mock).mockResolvedValue({ success: true });
  (api.delete as jest.Mock).mockResolvedValue({ success: true });
  pages['/posts/for-you'] = {
    data: { posts: [post('1', 'Ann one', 'Ann'), post('2', 'Ann two', 'Ann'), post('3', 'Bob one', 'Bob')] },
  };
});

it('hides a post with Not interested and brings it back with Undo', async () => {
  render(<PostsList feed="forYou" />);
  openMenu('Ann one');
  fireEvent.click(screen.getAllByText('Not interested')[0]);
  await screen.findByText('Got it. You won’t see this post in For You.');
  expect(api.put).toHaveBeenCalledWith('/posts/1/not-interested');
  expect(screen.queryByText('Ann one')).toBeNull();
  // Only that post: Ann's other post stays.
  expect(screen.getByText('Ann two')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await screen.findByText('Ann one');
  expect(api.delete).toHaveBeenCalledWith('/posts/1/not-interested');
});

it('hides every card by an author on the page, and Undo restores them', async () => {
  render(<PostsList feed="forYou" />);
  openMenu('Ann one');
  fireEvent.click(screen.getAllByText('Hide Ann from For You')[0]);
  await screen.findByText('You won’t see posts from Ann in For You.');
  expect(api.put).toHaveBeenCalledWith('/posts/1/hide-author');
  expect(screen.queryByText('Ann two')).toBeNull();
  expect(screen.getByText('Bob one')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(screen.getByText('Ann two')).toBeTruthy());
  expect(screen.getByText('Ann one')).toBeTruthy();
  expect(api.delete).toHaveBeenCalledWith('/posts/1/hide-author');
});

it('keeps the card and shows the error when hiding fails', async () => {
  const { ApiError } = jest.requireActual('../lib/api');
  (api.put as jest.Mock).mockRejectedValue(new ApiError('Could not save', 500));
  render(<PostsList feed="forYou" />);
  openMenu('Bob one');
  fireEvent.click(screen.getAllByText('Not interested')[2]);
  await screen.findByText('Could not save');
  expect(screen.getByText('Bob one')).toBeTruthy();
});

it('offers neither option outside For You', () => {
  pages['/posts?preview=normal'] = { data: { posts: [post('9', 'Friend post', 'Cat')] } };
  render(<PostsList />);
  openMenu('Friend post');
  expect(screen.queryByText('Not interested')).toBeNull();
  expect(screen.queryByText(/from For You/)).toBeNull();
});
