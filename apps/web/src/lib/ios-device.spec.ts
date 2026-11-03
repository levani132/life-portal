import { isIOSDevice } from './ios-device';
it.each([
  ['iPhone', 'iPhone', 1, true],
  ['iPad', 'iPad', 5, true],
  ['Mozilla/5.0 (Macintosh)', 'MacIntel', 5, true],
  ['Mozilla/5.0 (Macintosh)', 'MacIntel', 0, false],
  ['Mozilla/5.0 (Windows NT 10.0)', 'Win32', 0, false],
  ['Mozilla/5.0 (Linux; Android 16)', 'Linux', 5, false],
])(
  'detects Health support on %s / %s',
  (userAgent, platform, maxTouchPoints, expected) => {
    expect(isIOSDevice({ userAgent, platform, maxTouchPoints })).toBe(expected);
  },
);
