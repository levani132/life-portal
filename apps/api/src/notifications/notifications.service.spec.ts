import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FEATURE_IDS, type FeatureAccess, type NotificationEvent } from '@life-portal/shared-types';
import { NotificationsService, type NotificationTypeDef } from './notifications.service';
import { RegisterDeviceDto, UpdateNotificationPreferencesDto } from './notifications.dto';
import { pushConfig } from '../config/configuration';

const all = Object.fromEntries(FEATURE_IDS.map((id) => [id, true])) as FeatureAccess;
const NOW = new Date('2026-11-03T12:00:00Z');

function lean<T>(value: T) {
  return { lean: async () => value };
}

function fixture(options: { configured?: boolean } = {}) {
  const device = {
    _id: 'd'.repeat(24),
    userId: 'owner',
    endpoint: 'https://fcm.googleapis.com/fcm/send/x',
    keys: { p256dh: 'p', auth: 'a' },
  };
  const devices = {
    find: jest.fn((..._args: unknown[]) => lean([device])),
    findOneAndUpdate: jest.fn(() => lean({ _id: device._id })),
    deleteOne: jest.fn(async (..._args: unknown[]) => ({ deletedCount: 1 })),
    deleteMany: jest.fn(),
    updateOne: jest.fn(),
  };
  const sortable = {
    sort: jest.fn(),
    skip: jest.fn(),
    select: jest.fn(),
    lean: jest.fn(async (): Promise<unknown[]> => []),
  };
  sortable.sort.mockReturnValue(sortable);
  sortable.skip.mockReturnValue(sortable);
  sortable.select.mockReturnValue(sortable);
  let prefs: Record<string, unknown> | null = { userId: 'owner', enabled: true };
  const preferences = {
    findOne: jest.fn(() => ({
      lean: async () => prefs,
      select: () => ({ lean: async () => prefs }),
    })),
    findOneAndUpdate: jest.fn(() => lean(prefs)),
    updateOne: jest.fn(),
  };
  const deliveries = {
    findOneAndUpdate: jest.fn((..._args: unknown[]) => lean<unknown>(null)),
    updateOne: jest.fn(async (..._args: unknown[]) => ({ matchedCount: 0 })),
    create: jest.fn(async (..._args: unknown[]) => ({})),
  };
  const sender = {
    configured: options.configured ?? true,
    publicKey: 'pub',
    send: jest.fn(async (..._args: unknown[]) => 'ok' as 'ok' | 'gone' | 'failed'),
  };
  const access = { forUser: jest.fn(async (_id: string) => ({ access: all })) };
  const graph = {
    between: jest.fn(async (..._args: unknown[]) => null as unknown),
    blockedUserIds: jest.fn(async () => [] as string[]),
  };
  const service = new NotificationsService(
    devices as never,
    preferences as never,
    deliveries as never,
    sender as never,
    access as never,
    graph as never,
  );
  service.now = () => NOW;
  const like: NotificationTypeDef = {
    type: 'postLike',
    requires: ['social', 'foodPosts'],
    windowMs: 15 * 60_000,
    collapseKey: (e) => e.targetId,
    url: (e) => `/posts/${e.targetId}`,
  };
  service.register(like);
  return {
    service,
    devices,
    sortable,
    preferences,
    deliveries,
    sender,
    access,
    graph,
    device,
    setPrefs: (value: Record<string, unknown> | null) => {
      prefs = value;
    },
  };
}

const event: NotificationEvent = {
  type: 'postLike',
  recipientId: 'owner',
  actorId: 'fan',
  actorName: 'Ana',
  targetId: 'post1',
  postTitle: 'Lunch',
};

describe('NotificationsService.notify', () => {
  it('sends the first like with names, the own post title and a same-origin URL', async () => {
    const f = fixture();
    await f.service.notify(event);
    expect(f.sender.send).toHaveBeenCalledWith(
      f.device,
      expect.objectContaining({
        title: 'Ana',
        body: 'liked “Lunch”',
        url: '/posts/post1',
        tag: 'postLike:post1',
      }),
    );
    expect(f.deliveries.create).toHaveBeenCalled();
  });

  it('sends nothing when push is not configured or the type is unknown', async () => {
    const off = fixture({ configured: false });
    await off.service.notify(event);
    expect(off.devices.find).not.toHaveBeenCalled();
    const f = fixture();
    await f.service.notify({ ...event, type: 'friendRequest' });
    expect(f.sender.send).not.toHaveBeenCalled();
  });

  it('applies the skip rules: preferences, blocks, mutes and access', async () => {
    const f = fixture();
    f.setPrefs(null);
    await f.service.notify(event);
    f.setPrefs({ enabled: true, types: { postLike: false } });
    await f.service.notify(event);
    f.setPrefs({ enabled: true });
    f.graph.between.mockResolvedValueOnce({ blockedBy: ['fan'], mutedBy: [] });
    await f.service.notify(event);
    f.graph.between.mockResolvedValueOnce({ blockedBy: [], mutedBy: ['owner'] });
    await f.service.notify(event);
    f.access.forUser.mockImplementation(async (id: string) => ({
      access: id === 'owner' ? { ...all, push: false } : all,
    }));
    await f.service.notify(event);
    expect(f.sender.send).not.toHaveBeenCalled();
  });

  it('suppresses inside the window and reports the skipped count after it', async () => {
    const f = fixture();
    f.deliveries.updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    await f.service.notify(event);
    expect(f.sender.send).not.toHaveBeenCalled();

    f.deliveries.findOneAndUpdate.mockReturnValueOnce(lean({ suppressed: 4 }));
    await f.service.notify(event);
    expect(f.sender.send).toHaveBeenCalledWith(
      f.device,
      expect.objectContaining({ body: 'and 4 others liked “Lunch”' }),
    );
    const [filter] = f.deliveries.findOneAndUpdate.mock.calls[1] as [
      { lastSentAt: { $lte: Date } },
    ];
    expect(filter.lastSentAt.$lte.toISOString()).toBe('2026-11-03T11:45:00.000Z');
  });

  it('retries the decision when a concurrent like created the row first', async () => {
    const f = fixture();
    f.deliveries.create.mockRejectedValueOnce({ code: 11000 });
    f.deliveries.updateOne
      .mockResolvedValueOnce({ matchedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 1 });
    await f.service.notify(event);
    expect(f.sender.send).not.toHaveBeenCalled();
    expect(f.deliveries.updateOne).toHaveBeenCalledTimes(2);
  });

  it('deletes a device the push service reports gone', async () => {
    const f = fixture();
    f.sender.send.mockResolvedValueOnce('gone');
    await f.service.notify(event);
    expect(f.devices.deleteOne).toHaveBeenCalledWith({
      _id: f.device._id,
      endpoint: f.device.endpoint,
    });
  });

  it('never rejects, so a failure cannot fail the action that caused it', async () => {
    const f = fixture();
    f.devices.find.mockImplementationOnce(() => {
      throw new Error('db down');
    });
    await expect(f.service.notify(event)).resolves.toBeUndefined();
  });

  it('honours a type’s suppress hook (for chat: already looking at it)', async () => {
    const f = fixture();
    f.service.register({
      type: 'postComment',
      requires: [],
      windowMs: 0,
      collapseKey: (e) => e.targetId,
      url: () => '/x',
      suppress: async () => true,
    });
    await f.service.notify({ ...event, type: 'postComment' });
    expect(f.sender.send).not.toHaveBeenCalled();
  });
});

describe('NotificationsService devices', () => {
  it('upserts by endpoint, so a shared device moves to whoever signed in', async () => {
    const f = fixture();
    f.devices.find.mockReturnValue(f.sortable as never);
    await f.service.registerDevice(
      'newcomer',
      { endpoint: f.device.endpoint, keys: f.device.keys },
      'iPhone',
      false,
    );
    expect(f.devices.findOneAndUpdate).toHaveBeenCalledWith(
      { endpoint: f.device.endpoint },
      expect.objectContaining({
        $set: expect.objectContaining({ userId: 'newcomer' }),
      }),
      expect.anything(),
    );
    // A background re-sync never turns notifications back on.
    expect(f.preferences.updateOne).not.toHaveBeenCalled();
  });

  it('keeps at most 10 devices, evicting the least recently used', async () => {
    const f = fixture();
    f.devices.find.mockReturnValue(f.sortable as never);
    f.sortable.lean.mockResolvedValueOnce([{ _id: 'old' }]);
    await f.service.registerDevice(
      'owner',
      { endpoint: f.device.endpoint, keys: f.device.keys },
      'Mac',
      true,
    );
    expect(f.sortable.skip).toHaveBeenCalledWith(10);
    expect(f.devices.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['old'] } });
    expect(f.preferences.updateOne).toHaveBeenCalled();
  });

  it('removes only the caller’s own device', async () => {
    const f = fixture();
    f.devices.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    await expect(f.service.removeDevice('owner', 'e'.repeat(24))).rejects.toThrow(
      'Device not found.',
    );
    expect(f.devices.deleteOne).toHaveBeenCalledWith({
      _id: 'e'.repeat(24),
      userId: 'owner',
    });
  });
});

describe('NotificationsService preferences and activity', () => {
  it('reports untouched types as on and the offer pause for 14 days', async () => {
    const f = fixture();
    f.setPrefs({
      enabled: true,
      types: { postLike: false },
      offerDismissedAt: new Date('2026-11-01T12:00:00Z'),
    });
    const prefs = await f.service.getPreferences('owner');
    expect(prefs.types).toEqual({
      friendRequest: true,
      friendAccepted: true,
      postComment: true,
      postLike: false,
      message: true,
    });
    expect(prefs.showCommentPreviews).toBe(false);
    expect(prefs.offerHiddenUntil).toBe('2026-11-15T12:00:00.000Z');
  });

  it('never puts a field in both $set and $setOnInsert', async () => {
    const f = fixture();
    await f.service.updatePreferences('owner', { enabled: true, types: { postLike: false } });
    const [, update] = f.preferences.findOneAndUpdate.mock.calls[0] as unknown as [
      unknown,
      { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> },
    ];
    expect(update.$set).toEqual({ enabled: true, 'types.postLike': false });
    expect(Object.keys(update.$setOnInsert)).toEqual(['userId']);
  });

  it('merges sources, drops own and blocked actors, and counts unseen for the badge', async () => {
    const f = fixture();
    f.setPrefs({ activitySeenAt: new Date('2026-11-03T09:00:00Z') });
    f.graph.blockedUserIds.mockResolvedValue(['blocked']);
    const row = (actorId: string, hour: number, targetId = 'p1') => ({
      type: 'postLike' as const,
      actorId,
      actorName: actorId,
      targetId,
      url: `/posts/${targetId}`,
      createdAt: new Date(Date.UTC(2026, 10, 3, hour)),
    });
    f.service.registerActivitySource({
      rows: async () => [row('a', 10), row('blocked', 11, 'p2'), row('owner', 11, 'p3'), row('b', 8, 'p4')],
    });
    f.service.registerBadgeSource({ unseen: async () => 2 });
    const page = await f.service.activity('owner');
    expect(page.items.map((i) => i.id)).toEqual(['postLike:p1', 'postLike:p4']);
    expect(page.items.map((i) => i.unseen)).toEqual([true, false]);
    expect(await f.service.badgeCount('owner')).toBe(3);
  });
});

describe('validation and config', () => {
  it('refuses subscription endpoints outside known push services', async () => {
    const dto = plainToInstance(RegisterDeviceDto, {
      subscription: {
        endpoint: 'https://169.254.169.254/latest/meta-data',
        keys: { p256dh: 'abc', auth: 'def' },
      },
      label: 'iPhone',
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
    dto.subscription.endpoint = 'https://web.push.apple.com/QGxyz';
    expect(await validate(dto)).toHaveLength(0);
  });

  it('refuses unknown notification types in preferences', async () => {
    const dto = plainToInstance(UpdateNotificationPreferencesDto, {
      types: { postLike: false, spam: true },
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('needs all three VAPID variables or none', () => {
    expect(pushConfig({})).toBeUndefined();
    expect(() => pushConfig({ VAPID_PUBLIC_KEY: 'abc' })).toThrow(
      'missing VAPID_PRIVATE_KEY, VAPID_SUBJECT',
    );
    expect(() =>
      pushConfig({ VAPID_PUBLIC_KEY: 'abc', VAPID_PRIVATE_KEY: 'def', VAPID_SUBJECT: 'you' }),
    ).toThrow('VAPID_SUBJECT');
    expect(
      pushConfig({
        VAPID_PUBLIC_KEY: 'abc',
        VAPID_PRIVATE_KEY: 'def',
        VAPID_SUBJECT: 'mailto:a@b.c',
      }),
    ).toEqual({ publicKey: 'abc', privateKey: 'def', subject: 'mailto:a@b.c' });
  });
});
