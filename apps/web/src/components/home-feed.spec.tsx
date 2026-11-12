import { act, fireEvent, render, screen } from '@testing-library/react';
import type { PostPage } from '@life-portal/shared-types';
import { HomeFeed } from './home-feed';

const pages: Record<string, { data?: PostPage; error?: Error; isLoading?: boolean }> = {};
const requested: string[] = [];
jest.mock('../lib/hooks', () => ({
  ...jest.requireActual('../lib/hooks'),
  useApi: (url: string | null) => {
    if (url) requested.push(url);
    return url ? (pages[url] ?? { isLoading: true }) : { data: undefined };
  },
  revalidate: jest.fn(),
}));
// These tests are about the feed, not the card's footer and media.
jest.mock('./post-engagement', () => ({ PostEngagement: () => null }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const post = (id: string, title: string) =>
  ({
    id,
    title,
    caption: '',
    audience: 'public',
    author: { userId: 'a', displayName: 'A', username: 'a' },
    createdAt: '2026-11-12T10:00:00Z',
    updatedAt: '2026-11-12T10:00:00Z',
    version: 1,
    media: [],
    isOwner: false,
    itemCount: 0,
    items: [],
  }) as never;

beforeEach(() => {
  for (const key of Object.keys(pages)) delete pages[key];
  requested.length = 0;
  sessionStorage.clear();
  window.scrollTo = jest.fn();
});

it('opens on For You and loads Friends only when chosen, keeping both mounted', () => {
  pages['/posts/for-you'] = { data: { posts: [post('1', 'Public oats')] } };
  pages['/posts?preview=normal'] = { data: { posts: [post('2', 'Friend soup')] } };
  render(<HomeFeed />);
  const forYou = screen.getByRole('tab', { name: 'For You' });
  expect(forYou.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('Public oats')).toBeTruthy();
  expect(requested).not.toContain('/posts?preview=normal');

  fireEvent.click(screen.getByRole('tab', { name: 'Friends' }));
  expect(screen.getByRole('tab', { name: 'Friends' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('Friend soup')).toBeTruthy();
  // For You is hidden, not unmounted, so its page survives the switch.
  expect(screen.getByText('Public oats').closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true);
  expect(sessionStorage.getItem('home-feed-tab')).toBe('friends');
});

it('keeps each tab’s own page when switching back and forth', () => {
  pages['/posts/for-you'] = { data: { posts: [post('1', 'Discover 1')], nextCursor: 'c1' } };
  pages['/posts/for-you?cursor=c1'] = { data: { posts: [post('3', 'Discover 2')] } };
  pages['/posts?preview=normal'] = { data: { posts: [post('2', 'Friend 1')] } };
  render(<HomeFeed />);
  fireEvent.click(screen.getByRole('button', { name: 'Older posts' }));
  expect(screen.getByText('Discover 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Friends' }));
  fireEvent.click(screen.getByRole('tab', { name: 'For You' }));
  expect(screen.getByText('Discover 2')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Newer posts' })).toBeTruthy();
});

it('points an empty For You at Friends', () => {
  pages['/posts/for-you'] = { data: { posts: [] } };
  pages['/posts?preview=normal'] = { data: { posts: [post('2', 'Friend 1')] } };
  render(<HomeFeed />);
  expect(screen.getByText(/Nothing to discover yet/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'See posts from your friends' }));
  expect(screen.getByRole('tab', { name: 'Friends' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('Friend 1')).toBeTruthy();
});

it('shows loading and error states per tab', () => {
  pages['/posts?preview=normal'] = { error: new Error('Friends failed') };
  render(<HomeFeed />);
  expect(screen.getByText('Loading posts…')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Friends' }));
  expect(screen.getByText('Friends failed')).toBeTruthy();
});

it('moves between tabs with the arrow, Home and End keys', () => {
  render(<HomeFeed />);
  const list = screen.getByRole('tablist');
  fireEvent.keyDown(list, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Friends' }).getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement?.textContent).toBe('Friends');
  fireEvent.keyDown(list, { key: 'Home' });
  expect(screen.getByRole('tab', { name: 'For You' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(list, { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Friends' }).getAttribute('aria-selected')).toBe('true');
  expect(list.hasAttribute('data-no-tab-swipe')).toBe(true);
});

it('restores the session’s last tab', async () => {
  sessionStorage.setItem('home-feed-tab', 'friends');
  pages['/posts?preview=normal'] = { data: { posts: [post('2', 'Friend 1')] } };
  await act(async () => {
    render(<HomeFeed />);
  });
  expect(screen.getByRole('tab', { name: 'Friends' }).getAttribute('aria-selected')).toBe('true');
});
