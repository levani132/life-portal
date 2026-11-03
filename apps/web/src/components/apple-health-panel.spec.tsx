import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ActivityAdjustment } from '@life-portal/shared-types';
import {
  AppleHealthPanel,
  HealthConnectionSettings,
  HealthSyncBridge,
  HealthSyncButton,
} from './apple-health';
import { useApi } from '../lib/hooks';
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
  useApi: jest.fn(() => status),
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
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'iPhone',
  });
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: 'iPhone',
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    value: 1,
  });
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

it.each([
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Mozilla/5.0 (Linux; Android 16)',
])('shows only the settings compatibility note on %s', (userAgent) => {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: 'unsupported',
  });
  render(
    <>
      <AppleHealthPanel />
      <HealthSyncButton />
      <HealthSyncBridge enabled />
      <HealthConnectionSettings />
    </>,
  );
  expect(screen.getByText(/Health syncing works only on iOS/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Sync/ })).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Life Portal Health/ }),
  ).toBeNull();
  expect(useApi).not.toHaveBeenCalled();
});
it('explains manual schedule setup without claiming installation enables it', () => {
  render(<HealthConnectionSettings />);
  expect(
    screen.getByText(/Installing the Shortcut does not enable its schedule/),
  ).toBeTruthy();
  expect(screen.getByText(/enable its scheduled runs/)).toBeTruthy();
  expect(screen.getByText(/every 20 days/)).toBeTruthy();
});
