import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FeedPreferences, PortalState } from '@life-portal/shared-types';
import { ForYouSettings, InterestPicker } from './for-you-preferences';
import { PortalPreferencesPanel } from './portal-preferences';
import { api } from '../lib/api';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('../lib/api', () => ({ api: { put: jest.fn(), post: jest.fn() } }));
let prefs: FeedPreferences = { interests: ['baking'] };
const mutate = jest.fn(async (next: FeedPreferences) => {
  prefs = next;
});
let portalState: Partial<PortalState> = {};
const requested: (string | null)[] = [];
jest.mock('../lib/hooks', () => ({
  revalidate: jest.fn(),
  useApi: (url: string | null) => {
    requested.push(url);
    if (url === '/posts/for-you/preferences') return { data: prefs, mutate };
    if (url === '/portal') return { data: portalState };
    return { data: undefined };
  },
}));
jest.mock('./apple-health', () => ({ AppleHealthPanel: () => null }));
jest.mock('./nutrition-onboarding', () => ({ NutritionOnboarding: () => null }));

const access = (forYouRanking: boolean) =>
  ({ forYou: true, social: true, foodPosts: true, nutrition: true, forYouRanking }) as PortalState['access'];

beforeEach(() => {
  prefs = { interests: ['baking'] };
  requested.length = 0;
  jest.clearAllMocks();
});

it('saves each tap: choosing adds, choosing again removes', async () => {
  (api.put as jest.Mock).mockResolvedValue({ interests: ['baking', 'vegan'] });
  const { rerender } = render(<InterestPicker />);
  expect(screen.getByRole('button', { name: 'Baking' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('group', { name: 'Diet' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Vegan' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/posts/for-you/preferences', { interests: ['baking', 'vegan'] }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Baking' }) as HTMLButtonElement).disabled).toBe(false));
  rerender(<InterestPicker />); // SWR would re-render with the saved list
  expect(screen.getByRole('button', { name: 'Vegan' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Baking' }));
  await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/posts/for-you/preferences', { interests: ['vegan'] }));
});

it('clears interests and resets recommendations only after confirming, with honest copy', async () => {
  (api.put as jest.Mock).mockResolvedValue({ interests: [] });
  (api.post as jest.Mock).mockResolvedValue({ interests: [], recommendationsResetAt: '2026-11-13T03:00:00.000Z' });
  const { rerender } = render(<ForYouSettings portal={{ access: access(false) } as PortalState} />);
  expect(screen.getByText(/will use these once personalised ranking is turned on/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear interests' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/posts/for-you/preferences', { interests: [] }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Reset recommendations' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Reset recommendations' }));
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/posts/for-you/reset', {}));
  rerender(<ForYouSettings portal={{ access: access(true) } as PortalState} />);
  expect(screen.getByText(/Posts that match lift a little in For You/)).toBeTruthy();
});

it('is absent, and fetches nothing, without For You', () => {
  const { container } = render(<ForYouSettings portal={{ access: { ...access(true), forYou: false } } as PortalState} />);
  expect(container.innerHTML).toBe('');
  expect(requested).not.toContain('/posts/for-you/preferences');
});

it('offers interests as a skippable setup step for accounts with For You', async () => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Windows' });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
  portalState = {
    completedSetupSteps: ['modules', 'privacy', 'home', 'nutrition-profile-v2', 'apple-health-v1'],
    selectedModules: ['nutrition'],
    moduleVisibility: { nutrition: 'private' } as PortalState['moduleVisibility'],
    widgetOrder: ['nutrition'],
    access: access(true),
  };
  (api.put as jest.Mock).mockResolvedValue({});
  render(<PortalPreferencesPanel mode="setup" />);
  expect(await screen.findByRole('heading', { name: 'Your interests' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Baking' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Skip for now / continue' }));
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/portal', expect.objectContaining({ completedSetupSteps: expect.arrayContaining(['interests-v1']) })),
  );
});
