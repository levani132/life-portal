import { postTimeLabel } from './post-time';
it('uses relative time through a week and a date after that', () => {
  const date = '2026-11-01T00:00:00Z';
  const start = Date.parse(date);
  expect(postTimeLabel(date, start + 5000)).toBe('Just now');
  expect(postTimeLabel(date, start + 30000)).toBe('Recently');
  expect(postTimeLabel(date, start + 120000)).toBe('2 minutes ago');
  expect(postTimeLabel(date, start + 3600000)).toBe('1 hour ago');
  expect(postTimeLabel(date, start + 86400000)).toBe('1 day ago');
  expect(postTimeLabel(date, start + 7 * 86400000)).toBe('7 days ago');
  expect(postTimeLabel(date, start + 7 * 86400000 + 1000)).not.toContain('ago');
});
