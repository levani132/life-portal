import {
  healthShortcutUrl,
  healthSyncDue,
  healthTokenState,
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
      uploadUrl: 'https://example.com/api/nutrition/health/upload',
      limitPerKind: 50,
    }),
  );
  expect(url.hostname).toBe('run-shortcut');
  expect(url.searchParams.get('name')).toBe('Life Portal Health');
  expect(JSON.parse(url.searchParams.get('text')!)).toMatchObject({
    token: 'test-ticket',
    uploadUrl: 'https://example.com/api/nutrition/health/upload',
    limitPerKind: 50,
  });
  expect(Object.keys(JSON.parse(url.searchParams.get('text')!)).sort()).toEqual(
    ['limitPerKind', 'token', 'uploadUrl'],
  );
  for (const key of ['x-success', 'x-error', 'x-cancel'])
    expect(url.searchParams.has(key)).toBe(false);
});

it('requests renewal at day 20 even when scheduled uploads keep arriving', () => {
  const manual = '2026-11-03T00:00:00Z';
  const start = Date.parse(manual);
  const day = 24 * 60 * 60 * 1000;
  const expires = new Date(start + 30 * day).toISOString();
  expect(healthTokenState(manual, expires, start + 20 * day - 1)).toBe(
    'active',
  );
  expect(healthTokenState(manual, expires, start + 20 * day)).toBe('renew');
  expect(healthTokenState(manual, expires, start + 30 * day)).toBe('expired');
  expect(healthTokenState(manual, undefined, start)).toBe('expired');
  expect(healthTokenState(undefined, expires, start)).toBe('renew');
});
