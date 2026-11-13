import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FeedMetricsStatus } from '@life-portal/shared-types';
import { MeasurementSettings, measurementState } from './for-you-preferences';
import { FeedMetricsTracker } from '../lib/feed-metrics';
import { api } from '../lib/api';

jest.mock('../lib/api', () => ({ api: { put: jest.fn() }, API_URL: '', tokens: {} }));
let status: FeedMetricsStatus = { enabled: false, optedOut: false, active: false };
const mutate = jest.fn(async (next: FeedMetricsStatus) => {
  status = next;
});
jest.mock('../lib/hooks', () => ({
  useApi: (url: string | null) => (url === '/posts/for-you/metrics' ? { data: status, mutate } : { data: undefined }),
}));

it('says plainly whether For You viewing is counted', () => {
  expect(measurementState({ enabled: false, optedOut: false, active: false })).toMatch(/^Not running/);
  expect(measurementState({ enabled: true, optedOut: false, active: true })).toMatch(/^On:/);
  expect(measurementState({ enabled: true, optedOut: true, active: false })).toMatch(/^Off: you opted out/);
});

it('explains what is kept and lets the account opt out before measurement ever runs', async () => {
  (api.put as jest.Mock).mockResolvedValue({ enabled: false, optedOut: true, active: false });
  render(<MeasurementSettings />);
  expect(screen.getByText(/pseudonymous, not anonymous/)).toBeTruthy();
  expect(screen.getByText(/deleted after 90 days/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /Don.t measure my For You viewing/ }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/posts/for-you/metrics', { optedOut: true }));
  expect(mutate).toHaveBeenCalledWith({ enabled: false, optedOut: true, active: false }, { revalidate: false });
});

it('queues each post and event once, marks the first batch as a visit and sends in 50s', () => {
  const sent: unknown[] = [];
  const tracker = new FeedMetricsTracker((batch) => sent.push(batch));
  tracker.record('p1', 'impression');
  tracker.record('p1', 'impression');
  tracker.record('p1', 'like');
  tracker.flush();
  tracker.flush();
  expect(sent).toEqual([
    {
      events: [
        { postId: 'p1', type: 'impression' },
        { postId: 'p1', type: 'like' },
      ],
      visit: true,
    },
  ]);
  for (let i = 0; i < 50; i++) tracker.record(`q${i}`, 'impression');
  expect(sent).toHaveLength(2);
  expect((sent[1] as { events: unknown[]; visit?: boolean }).events).toHaveLength(50);
  expect(sent[1]).not.toHaveProperty('visit');
});

it('drops what is queued when measurement is switched off, instead of sending it', () => {
  const sent: unknown[] = [];
  const tracker = new FeedMetricsTracker((batch) => sent.push(batch));
  tracker.start();
  tracker.record('p1', 'impression');
  tracker.stop(true);
  expect(sent).toEqual([]);
});
