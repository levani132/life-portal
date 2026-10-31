import { render, fireEvent, act } from '@testing-library/react';
import { HealthSyncBridge } from './apple-health';
import { api } from '../lib/api';
jest.mock('../lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'person' } }),
}));
jest.mock('../lib/api', () => ({
  API_URL: 'https://example.com/api',
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../lib/hooks', () => ({ revalidate: jest.fn(), useApi: jest.fn() }));
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
