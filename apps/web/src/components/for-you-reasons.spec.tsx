import { fireEvent, render, screen } from '@testing-library/react';
import type { PostPage } from '@life-portal/shared-types';
import { ForYouReasons, PostsList } from './posts';

const pages: Record<string, { data?: PostPage }> = {};
const configs: Record<string, unknown> = {};
jest.mock('../lib/hooks', () => ({
  ...jest.requireActual('../lib/hooks'),
  useApi: (url: string | null, config?: unknown) => {
    if (url) configs[url] = config;
    return url ? (pages[url] ?? { isLoading: true }) : { data: undefined };
  },
  revalidate: jest.fn(),
}));
jest.mock('./post-engagement', () => ({ PostEngagement: () => null }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

beforeEach(() => {
  for (const key of Object.keys(pages)) delete pages[key];
});

it('shows the first reason, and all of them with their basis when opened', () => {
  render(
    <ForYouReasons
      reasons={[
        { code: 'topic', topicId: 'tag:pasta', text: 'Because you engaged with posts tagged #pasta' },
        { code: 'popular', text: 'Popular with members' },
      ]}
    />,
  );
  const summary = screen.getByText('Because you engaged with posts tagged #pasta', { selector: 'summary' });
  fireEvent.click(summary);
  expect(screen.getByText('Popular with members')).toBeTruthy();
  expect(screen.getByText(/Never your food logs, weight or health data/)).toBeTruthy();
});

it('shows nothing without reasons (the chronological fallback)', () => {
  const { container } = render(<ForYouReasons reasons={[]} />);
  expect(container.innerHTML).toBe('');
});

it('does not poll For You, and offers a way back when the session expired', () => {
  pages['/posts/for-you'] = { data: { posts: [], expired: true } };
  render(<PostsList feed="forYou" />);
  expect(configs['/posts/for-you']).toMatchObject({ refreshInterval: 0, revalidateOnFocus: false });
  expect(screen.getByText(/has been refreshed/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Back to the top' })).toBeTruthy();
});
