import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ActivityAdjustment } from '@life-portal/shared-types';
import { AppleHealthPanel } from './apple-health';
import { HealthActivityChart } from './health-activity-chart';
import { writeHealthShortcutInstall } from '../lib/health-shortcut-install';
const user = { id: 'person' };
const url = `https://www.icloud.com/shortcuts/${'a'.repeat(32)}`;
const status = {
  data: { installationUrl: url, paired: true, limitPerKind: 50 },
  mutate: jest.fn(),
};
jest.mock('../lib/auth-context', () => ({ useAuth: () => ({ user }) }));
jest.mock('../lib/hooks', () => ({
  useApi: () => status,
  revalidate: jest.fn(),
}));
jest.mock('../lib/api', () => ({
  api: { post: jest.fn(), delete: jest.fn() },
  API_URL: 'https://example.com/api',
}));
const activity: ActivityAdjustment = {
  startingTargetKcal: 2000,
  currentTargetKcal: 2100,
  adjustmentKcal: 100,
  expectedReplacedKcal: 50,
  recordedActiveKcal: 150,
  steps: 1200,
  workouts: 0,
  status: 'partial',
  timeline: [
    {
      hour: 4,
      activeKcal: 150,
      steps: 1200,
      hasActiveEnergy: true,
      hasSteps: true,
    },
    {
      hour: 5,
      activeKcal: 0,
      steps: 0,
      hasActiveEnergy: false,
      hasSteps: false,
    },
  ],
};
beforeEach(() => {
  localStorage.clear();
});
it('updates the installation indicator immediately and distinguishes an older confirmed URL', () => {
  const view = render(<AppleHealthPanel activity={activity} />);
  expect(screen.getByText('Not installed on this device')).toBeTruthy();
  act(() => writeHealthShortcutInstall('person', { installedUrl: url }));
  expect(screen.getByText('Installed · confirmed on this device')).toBeTruthy();
  act(() =>
    writeHealthShortcutInstall('person', {
      installedUrl: `https://www.icloud.com/shortcuts/${'b'.repeat(32)}`,
    }),
  );
  expect(screen.getByText('Update available')).toBeTruthy();
  const install = jest.fn();
  window.addEventListener('lp-health-install', install);
  fireEvent.click(screen.getByRole('button', { name: /Life Portal Health/ }));
  expect(install).toHaveBeenCalled();
  window.removeEventListener('lp-health-install', install);
  view.unmount();
});
it('switches between recorded energy and steps without presenting missing hours as measured zeros', () => {
  const view = render(<HealthActivityChart activity={activity} />);
  expect(
    screen.getByRole('img', { name: /Active energy by local hour/ }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Steps' }));
  expect(screen.getByRole('img', { name: /Steps by local hour/ })).toBeTruthy();
  expect(screen.getByText('05:00 — No imported samples')).toBeTruthy();
  view.unmount();
});
