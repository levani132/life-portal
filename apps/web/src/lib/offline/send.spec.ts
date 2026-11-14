import { queuedAge } from './send';

describe('how long a write waited (issue #22)', () => {
  it('is whole seconds since it was queued, never negative', () => {
    expect(queuedAge({ createdAt: 1_000 }, 8_999)).toBe('7');
    expect(queuedAge({ createdAt: 5_000 }, 1_000)).toBe('0');
  });
});
