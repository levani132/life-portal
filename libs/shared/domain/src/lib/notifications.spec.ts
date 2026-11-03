import { FEATURE_IDS, type FeatureAccess } from '@life-portal/shared-types';
import {
  collapseCutoff,
  groupActivity,
  isPushServiceEndpoint,
  notificationTag,
  notificationText,
  shouldNotify,
  type ActivityRow,
} from './notifications';

const all = Object.fromEntries(FEATURE_IDS.map((id) => [id, true])) as FeatureAccess;
const event = { type: 'postLike' as const, recipientId: 'owner', actorId: 'fan' };
const base = {
  event,
  prefs: { enabled: true },
  requires: ['social', 'foodPosts'] as const,
  recipientAccess: all,
  actorAccess: all,
  connection: { blockedBy: [], mutedBy: [] },
};

describe('shouldNotify', () => {
  it('sends when every rule passes, treating untouched types as on', () => {
    expect(shouldNotify({ ...base, requires: [...base.requires] })).toBeNull();
    expect(
      shouldNotify({ ...base, requires: [...base.requires], connection: null }),
    ).toBeNull();
  });
  it('never notifies about your own action', () => {
    expect(
      shouldNotify({
        ...base,
        requires: [],
        event: { ...event, actorId: 'owner' },
      }),
    ).toBe('self');
  });
  it('needs the main switch on and the type not turned off', () => {
    expect(shouldNotify({ ...base, requires: [], prefs: undefined })).toBe(
      'not-enabled',
    );
    expect(
      shouldNotify({ ...base, requires: [], prefs: { enabled: false } }),
    ).toBe('not-enabled');
    expect(
      shouldNotify({
        ...base,
        requires: [],
        prefs: { enabled: true, types: { postLike: false, postComment: true } },
      }),
    ).toBe('type-off');
  });
  it('needs push and every required feature for the recipient, and social for the actor', () => {
    expect(
      shouldNotify({
        ...base,
        requires: [...base.requires],
        recipientAccess: { ...all, push: false },
      }),
    ).toBe('recipient-feature');
    expect(
      shouldNotify({
        ...base,
        requires: [...base.requires],
        recipientAccess: { ...all, foodPosts: false },
      }),
    ).toBe('recipient-feature');
    expect(
      shouldNotify({
        ...base,
        requires: [],
        actorAccess: { ...all, social: false },
      }),
    ).toBe('actor-feature');
  });
  it('skips blocks in either direction and actors the recipient muted', () => {
    for (const blocker of ['owner', 'fan'])
      expect(
        shouldNotify({
          ...base,
          requires: [],
          connection: { blockedBy: [blocker], mutedBy: [] },
        }),
      ).toBe('blocked');
    expect(
      shouldNotify({
        ...base,
        requires: [],
        connection: { blockedBy: [], mutedBy: ['owner'] },
      }),
    ).toBe('muted');
    // The actor muting the recipient does not silence the recipient's notifications.
    expect(
      shouldNotify({
        ...base,
        requires: [],
        connection: { blockedBy: [], mutedBy: ['fan'] },
      }),
    ).toBeNull();
  });
});

describe('collapse helpers', () => {
  it('computes the window cutoff from an explicit now', () => {
    expect(
      collapseCutoff(new Date('2026-11-03T10:15:00Z'), 15 * 60_000).toISOString(),
    ).toBe('2026-11-03T10:00:00.000Z');
  });
  it('builds a tag per type and target', () => {
    expect(notificationTag('postLike', 'p1')).toBe('postLike:p1');
  });
});

describe('notificationText', () => {
  const off = { showCommentPreviews: false };
  it('words each type with only names, the action and the own post title', () => {
    expect(
      notificationText({ type: 'friendRequest', actorName: 'Ana' }, off),
    ).toEqual({ title: 'Ana', body: 'sent you a friend request' });
    expect(
      notificationText({ type: 'friendAccepted', actorName: 'Ana' }, off),
    ).toEqual({ title: 'Ana', body: 'accepted your friend request' });
    expect(
      notificationText(
        { type: 'postLike', actorName: 'Ana', postTitle: 'Tuesday lunch' },
        off,
      ).body,
    ).toBe('liked “Tuesday lunch”');
  });
  it('counts collapsed likes', () => {
    const like = { type: 'postLike' as const, actorName: 'Ana', postTitle: 'Lunch' };
    expect(notificationText(like, { ...off, others: 1 }).body).toBe(
      'and 1 other liked “Lunch”',
    );
    expect(notificationText(like, { ...off, others: 4 }).body).toBe(
      'and 4 others liked “Lunch”',
    );
  });
  it('shows comment text only when previews are on, clipped', () => {
    const comment = {
      type: 'postComment' as const,
      actorName: 'Ana',
      postTitle: 'Lunch',
      commentText: 'x'.repeat(200),
    };
    expect(notificationText(comment, off).body).toBe('commented on “Lunch”');
    const shown = notificationText(comment, { showCommentPreviews: true }).body;
    expect(shown.startsWith('commented on “Lunch”: x')).toBe(true);
    expect(shown.length).toBeLessThanOrEqual('commented on “Lunch”: '.length + 80);
  });
  it('clips long titles and falls back when names or titles are empty', () => {
    const text = notificationText(
      { type: 'postLike', actorName: '  ', postTitle: 'y'.repeat(100) },
      off,
    );
    expect(text.title).toBe('Someone');
    expect(text.body.length).toBeLessThan(80);
    expect(
      notificationText({ type: 'postLike', actorName: 'Ana' }, off).body,
    ).toBe('liked your post');
  });
  it('ignores any extra fields a caller might pass', () => {
    const leaky = {
      type: 'postLike' as const,
      actorName: 'Ana',
      postTitle: 'Lunch',
      calories: 812,
    } as Parameters<typeof notificationText>[0];
    expect(JSON.stringify(notificationText(leaky, off))).not.toContain('812');
  });
});

describe('groupActivity', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 10, minute));
  const like = (actor: string, minute: number, post = 'p1'): ActivityRow => ({
    type: 'postLike',
    actorId: actor,
    actorName: actor.toUpperCase(),
    targetId: post,
    url: `/posts/${post}`,
    postTitle: 'Lunch',
    createdAt: at(minute),
  });
  it('groups likes per post, newest actors first, and counts the rest', () => {
    const items = groupActivity([
      like('a', 1),
      like('b', 2),
      like('c', 3),
      like('d', 4),
      like('e', 5),
      like('z', 6, 'p2'),
    ]);
    expect(items.map((i) => i.id)).toEqual(['postLike:p2', 'postLike:p1']);
    expect(items[1].actors.map((a) => a.userId)).toEqual(['e', 'd', 'c']);
    expect(items[1].othersCount).toBe(2);
    expect(items[1].createdAt).toBe(at(5).toISOString());
  });
  it('keeps every comment and friend event separate', () => {
    const comment = (minute: number): ActivityRow => ({
      ...like('a', minute),
      type: 'postComment',
    });
    expect(groupActivity([comment(1), comment(2)])).toHaveLength(2);
  });
  it('marks items newer than the last visit unseen', () => {
    const items = groupActivity([like('a', 1, 'p1'), like('b', 9, 'p2')], at(5));
    expect(items.map((i) => i.unseen)).toEqual([true, false]);
    expect(groupActivity([like('a', 1)])[0].unseen).toBe(true);
  });
});

describe('isPushServiceEndpoint', () => {
  it('accepts the major push services over HTTPS only', () => {
    for (const url of [
      'https://web.push.apple.com/QGx',
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=1',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
    ])
      expect(isPushServiceEndpoint(url)).toBe(true);
  });
  it('refuses anything that could point the server elsewhere', () => {
    for (const url of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://evil.example.com/push.apple.com',
      'https://push.apple.com.evil.example/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://127.0.0.1/',
      'not a url',
    ])
      expect(isPushServiceEndpoint(url)).toBe(false);
  });
});
