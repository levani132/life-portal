import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PortalPreferencesPanel } from './portal-preferences';
import { api } from '../lib/api';
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('../lib/api', () => ({ api: { put: jest.fn() } }));
jest.mock('../lib/hooks', () => ({
  revalidate: jest.fn(),
  useApi: () => ({
    data: {
      completedSetupSteps: [
        'modules',
        'privacy',
        'home',
        'nutrition-profile-v2',
      ],
      selectedModules: ['nutrition'],
      moduleVisibility: { nutrition: 'private' },
      widgetOrder: ['nutrition'],
      access: { nutrition: true },
    },
  }),
}));
jest.mock('./apple-health', () => ({
  AppleHealthPanel: () => <p>Health setup controls</p>,
}));
jest.mock('./nutrition-onboarding', () => ({
  NutritionOnboarding: () => null,
}));
it('skips the iOS-only step on desktop and finishes onboarding without leaving it pending', async () => {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Windows',
  });
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: 'Win32',
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    value: 0,
  });
  (api.put as jest.Mock).mockResolvedValue({});
  render(<PortalPreferencesPanel mode="setup" />);
  expect(
    await screen.findByRole('heading', { name: 'Ready to begin' }),
  ).toBeTruthy();
  expect(screen.queryByText('Health setup controls')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Go to my Home' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  expect(api.put).toHaveBeenCalledWith(
    '/portal',
    expect.objectContaining({
      completedSetupSteps: expect.arrayContaining(['apple-health-v1', 'ready']),
    }),
  );
});
