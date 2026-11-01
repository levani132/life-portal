import {
  render,
  fireEvent,
  act,
  screen,
  waitFor,
} from '@testing-library/react';
import { HealthSyncBridge } from './apple-health';
import { api } from '../lib/api';
import {
  healthShortcutInstallKey,
  openHealthShortcut,
} from '../lib/health-shortcut-install';
import { HEALTH_SYNC_INTERVAL_MS } from '../lib/health-sync';
const user = { id: 'person' };
jest.mock('../lib/auth-context', () => ({
  useAuth: () => ({ user }),
}));
jest.mock('../lib/health-shortcut-install', () => ({
  ...jest.requireActual('../lib/health-shortcut-install'),
  openHealthShortcut: jest.fn(),
}));
jest.mock('../lib/api', () => ({
  API_URL: 'https://example.com/api',
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../lib/hooks', () => ({ revalidate: jest.fn(), useApi: jest.fn() }));
const first = `https://www.icloud.com/shortcuts/${'a'.repeat(32)}`;
const next = `https://www.icloud.com/shortcuts/${'b'.repeat(32)}`;
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'iPhone',
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
it('never requests a launch on mount, focus, resume or timers even when Health is overdue', async () => {
  jest.useFakeTimers();
  (api.get as jest.Mock).mockResolvedValue({
    paired: true,
    lastSync: '2020-01-01T00:00:00Z',
  });
  try {
    const view = render(<HealthSyncBridge enabled />);
    await act(async () => {
      fireEvent.focus(window);
      fireEvent(document, new Event('visibilitychange'));
      jest.advanceTimersByTime(60000);
    });
    expect(api.post).not.toHaveBeenCalled();
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('requires explicit installation confirmation before pairing and launching', async () => {
  (api.get as jest.Mock).mockResolvedValue({
    paired: false,
    installationUrl: first,
  });
  (api.post as jest.Mock).mockImplementation(async (path) =>
    path.endsWith('/launch')
      ? {
          token: 'ticket',
          from: '2026-10-31T00:00:00Z',
          to: '2026-11-01T00:00:00Z',
        }
      : {},
  );
  const view = render(<HealthSyncBridge enabled />);
  expect(
    await screen.findByRole('heading', { name: 'Install the Health Shortcut' }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  expect(openHealthShortcut).toHaveBeenCalledWith(first);
  expect(
    JSON.parse(localStorage.getItem(healthShortcutInstallKey('person'))!),
  ).toEqual({ pendingUrl: first });
  await act(async () => {
    fireEvent.focus(window);
  });
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'I installed it — sync' }),
  );
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/nutrition/health/launch'),
  );
  expect(api.post).toHaveBeenCalledWith('/nutrition/health/pair');
  expect(
    JSON.parse(localStorage.getItem(healthShortcutInstallKey('person'))!)
      .installedUrl,
  ).toBe(first);
  expect((openHealthShortcut as jest.Mock).mock.calls.at(-1)[0]).toMatch(
    /^shortcuts:\/\/run-shortcut/,
  );
  view.unmount();
});

it('reminds about an update after six hours without launching on return or on the timer', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-02T00:00:00Z'));
  localStorage.setItem(
    healthShortcutInstallKey('person'),
    JSON.stringify({ installedUrl: first }),
  );
  (api.get as jest.Mock).mockResolvedValue({
    paired: true,
    installationUrl: next,
  });
  try {
    const view = render(<HealthSyncBridge enabled />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask me later' }));
    await act(async () => {
      fireEvent.focus(window);
      jest.advanceTimersByTime(HEALTH_SYNC_INTERVAL_MS - 15000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    expect(
      screen.getByRole('heading', { name: 'New Health Shortcut available' }),
    ).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
    expect(openHealthShortcut).not.toHaveBeenCalled();
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('does not repeat a declined update after reloading and still permits manual sync', async () => {
  localStorage.setItem(
    healthShortcutInstallKey('person'),
    JSON.stringify({ installedUrl: first }),
  );
  (api.get as jest.Mock).mockResolvedValue({
    paired: true,
    installationUrl: next,
  });
  let view = render(<HealthSyncBridge enabled />);
  await screen.findByRole('heading', { name: 'New Health Shortcut available' });
  fireEvent.click(screen.getByRole('button', { name: 'No' }));
  view.unmount();
  view = render(<HealthSyncBridge enabled />);
  await act(async () => {
    fireEvent.focus(window);
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => {
    window.dispatchEvent(new Event('lp-health-sync'));
  });
  expect(api.post).toHaveBeenCalledWith('/nutrition/health/launch');
  view.unmount();
});

it('does not mark a canceled installation as installed and offers setup on manual sync', async () => {
  (api.get as jest.Mock).mockResolvedValue({
    paired: true,
    installationUrl: first,
  });
  const view = render(<HealthSyncBridge enabled />);
  await screen.findByRole('heading', { name: 'Install the Health Shortcut' });
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  await act(async () => {
    fireEvent.focus(window);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Not yet' }));
  expect(
    JSON.parse(localStorage.getItem(healthShortcutInstallKey('person'))!)
      .installedUrl,
  ).toBeUndefined();
  expect(api.post).not.toHaveBeenCalled();
  await act(async () => {
    window.dispatchEvent(new Event('lp-health-sync'));
  });
  expect(
    screen.getByRole('heading', { name: 'Install the Health Shortcut' }),
  ).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  view.unmount();
});
