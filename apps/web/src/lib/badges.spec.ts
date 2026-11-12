import { request } from './api';
import './badges';

/**
 * Qualifying writes ask the API to evaluate badges (spec 022, research R4); everything else does
 * not. The throttle is module state shared by both cases, so the second relies on the first's
 * check still being inside its 30 s window.
 */
describe('badge checks after writes', () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url).replace(/^.*\/api/, '')}`);
      // jsdom has no `Response`; the client reads only these.
      return { ok: true, status: 200, json: async () => ({ newBadgeIds: [] }) };
    }) as unknown as typeof fetch;
  });

  const checks = () => calls.filter((call) => call.startsWith('POST /badges/check'));

  it('checks after logging a meal, and not after other writes or reads', async () => {
    await request('/nutrition/foods', { method: 'POST', body: {} });
    await request('/nutrition/entries', { method: 'GET' });
    expect(checks()).toHaveLength(0);

    await request('/nutrition/entries', { method: 'POST', body: {} });
    await Promise.resolve();
    expect(checks()).toHaveLength(1);
  });

  it('defers a second qualifying write inside the window instead of dropping it', async () => {
    jest.useFakeTimers();
    try {
      await request('/posts', { method: 'POST', body: {} });
      await Promise.resolve();
      expect(checks()).toHaveLength(0); // the first test's check is still inside the window
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
      expect(checks()).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
