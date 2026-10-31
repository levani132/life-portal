import {
  healthShortcutUrl,
  healthSyncDue,
  HEALTH_SYNC_INTERVAL_MS,
} from './health-sync';
it('reminds at six hours after receipt, including missing/invalid receipts', () => {
  const last = '2026-11-01T00:00:00Z',
    start = Date.parse(last);
  expect(healthSyncDue(last, start + HEALTH_SYNC_INTERVAL_MS - 1)).toBe(false);
  expect(healthSyncDue(last, start + HEALTH_SYNC_INTERVAL_MS)).toBe(true);
  expect(healthSyncDue(undefined, start)).toBe(true);
  expect(healthSyncDue('invalid', start)).toBe(true);
});
it('opens Shortcuts with input but never supplies a browser return callback', () => {
  const url = new URL(
    healthShortcutUrl({
      token: 'test-ticket',
      batchUrl: 'https://example.com/api',
    }),
  );
  expect(url.hostname).toBe('run-shortcut');
  expect(url.searchParams.get('name')).toBe('Life Portal Health');
  expect(JSON.parse(url.searchParams.get('text')!)).toMatchObject({
    token: 'test-ticket',
  });
  for (const key of ['x-success', 'x-error', 'x-cancel'])
    expect(url.searchParams.has(key)).toBe(false);
});
