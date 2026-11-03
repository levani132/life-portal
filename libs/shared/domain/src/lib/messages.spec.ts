import { FEATURE_IDS, type FeatureAccess } from '@life-portal/shared-types';
import {
  canMessage,
  isViewing,
  messagePreview,
  pairKey,
  seenLabel,
  timeSeparators,
} from './messages';

const all = Object.fromEntries(FEATURE_IDS.map((id) => [id, true])) as FeatureAccess;
const friends = { state: 'accepted', blockedBy: [] as string[] };

describe('pairKey', () => {
  it('is the same whichever member asks', () => {
    expect(pairKey('b', 'a')).toBe('a:b');
    expect(pairKey('a', 'b')).toBe('a:b');
  });
});

describe('canMessage', () => {
  it('allows accepted, unblocked friends who both have the feature', () => {
    expect(canMessage({ connection: friends, accessA: all, accessB: all })).toBeNull();
  });
  it('refuses strangers, pending requests and former friends', () => {
    expect(canMessage({ connection: null, accessA: all, accessB: all })).toBe('not-friends');
    for (const state of ['pending', 'none'])
      expect(
        canMessage({ connection: { state, blockedBy: [] }, accessA: all, accessB: all }),
      ).toBe('not-friends');
  });
  it('reports a block before anything else', () => {
    expect(
      canMessage({ connection: { state: 'none', blockedBy: ['b'] }, accessA: all, accessB: all }),
    ).toBe('blocked');
  });
  it('needs messages and social on both sides', () => {
    expect(
      canMessage({ connection: friends, accessA: all, accessB: { ...all, messages: false } }),
    ).toBe('feature');
    expect(
      canMessage({ connection: friends, accessA: { ...all, social: false }, accessB: all }),
    ).toBe('feature');
    expect(canMessage({ connection: friends, accessA: all, accessB: null })).toBe('feature');
  });
});

describe('messagePreview', () => {
  it('describes each kind in one line', () => {
    expect(messagePreview({ kind: 'text', text: ' hi\nthere ', unsent: false, fromMe: false })).toBe(
      'hi there',
    );
    expect(messagePreview({ kind: 'post', unsent: false, fromMe: true })).toBe(
      'You: Shared a post',
    );
    expect(messagePreview({ kind: 'text', text: 'secret', unsent: true, fromMe: false })).toBe(
      'Message unsent',
    );
  });
  it('clips long text to 80 characters', () => {
    const preview = messagePreview({ kind: 'text', text: 'x'.repeat(300), unsent: false, fromMe: false });
    expect(preview).toHaveLength(80);
    expect(preview.endsWith('…')).toBe(true);
  });
});

describe('isViewing', () => {
  const now = new Date('2026-11-03T12:00:15Z');
  it('counts a sync in the last 15 seconds as viewing', () => {
    expect(isViewing(new Date('2026-11-03T12:00:00Z'), now)).toBe(true);
    expect(isViewing(new Date('2026-11-03T11:59:59Z'), now)).toBe(false);
    expect(isViewing(undefined, now)).toBe(false);
  });
});

describe('seenLabel', () => {
  it('reads Seen once the other member read at or after your last message', () => {
    expect(seenLabel('2026-11-03T12:00:00Z', '2026-11-03T12:00:00Z')).toBe('Seen');
    expect(seenLabel('2026-11-03T12:00:00Z', '2026-11-03T11:00:00Z')).toBe('Sent');
    expect(seenLabel('2026-11-03T12:00:00Z', undefined)).toBe('Sent');
    expect(seenLabel(undefined, '2026-11-03T12:00:00Z')).toBeNull();
  });
});

describe('timeSeparators', () => {
  it('starts a group at the first message and after gaps over 15 minutes', () => {
    expect(
      timeSeparators([
        '2026-11-03T10:00:00Z',
        '2026-11-03T10:14:00Z',
        '2026-11-03T10:30:00Z',
        '2026-11-03T10:31:00Z',
      ]),
    ).toEqual([0, 2]);
    expect(timeSeparators([])).toEqual([]);
  });
});
