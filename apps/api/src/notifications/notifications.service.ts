import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  NOTIFICATION_TYPES,
  type ActivityPage,
  type FeatureAccess,
  type FeatureId,
  type NotificationEvent,
  type NotificationPreferences,
  type NotificationType,
  type NotificationsConfig,
  type PushDeviceSummary,
} from '@life-portal/shared-types';
import {
  collapseCutoff,
  groupActivity,
  notificationTag,
  notificationText,
  shouldNotify,
  typeEnabled,
  type ActivityRow,
} from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { SocialGraphService } from '../social-graph/social-graph.module';
import {
  NotificationDelivery,
  NotificationPreferencesRecord,
  PushDevice,
} from './notifications.schemas';
import { PushSender } from './push-sender';

/**
 * How one notification type behaves. The module that owns the event registers it, so adding
 * a type (chat, challenges) never changes this file (spec FR-029).
 */
export interface NotificationTypeDef {
  type: NotificationType;
  /** Features the recipient needs besides `push`. */
  requires: FeatureId[];
  /** 0 sends every event; otherwise at most one push per window per collapse key. */
  windowMs: number;
  collapseKey: (event: NotificationEvent) => string;
  /** Same-origin path the notification opens. */
  url: (event: NotificationEvent) => string;
  /** Re-checked at send time, e.g. the recipient can still read the post. */
  canStillSee?: (event: NotificationEvent) => Promise<boolean>;
  /**
   * Skip when the recipient already looks at the target (FR-030). Must be decided here, on
   * the server: iOS forbids a push that shows nothing, so the service worker cannot drop one.
   */
  suppress?: (event: NotificationEvent) => Promise<boolean>;
  /**
   * The event is about the recipient's own doing (a badge they earned), so actor and recipient
   * are the same person. Every other type keeps the `'self'` safeguard.
   */
  selfAllowed?: true;
}

/** Supplies Activity rows from data its module owns. Rows by blocked users are filtered here. */
export interface ActivitySource {
  rows(userId: string, since: Date, before: Date | undefined, limit: number): Promise<ActivityRow[]>;
}

/** An unread count that is not Activity, e.g. unread messages, added to the icon badge. */
export interface BadgeSource {
  unseen(userId: string): Promise<number>;
}

const ACTIVITY_DAYS = 30;
const PAGE = 20;
const PER_SOURCE = 50;
const MAX_DEVICES = 10;
const OFFER_PAUSE_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly types = new Map<NotificationType, NotificationTypeDef>();
  private readonly activitySources: ActivitySource[] = [];
  private readonly badgeSources: BadgeSource[] = [];
  /** Injectable for tests; "now" is otherwise the only implicit input. */
  now: () => Date = () => new Date();

  constructor(
    @InjectModel(PushDevice.name) private readonly devices: Model<PushDevice>,
    @InjectModel(NotificationPreferencesRecord.name)
    private readonly preferences: Model<NotificationPreferencesRecord>,
    @InjectModel(NotificationDelivery.name)
    private readonly deliveries: Model<NotificationDelivery>,
    private readonly sender: PushSender,
    private readonly access: AccessService,
    private readonly graph: SocialGraphService,
  ) {}

  register(def: NotificationTypeDef) {
    this.types.set(def.type, def);
  }
  registerActivitySource(source: ActivitySource) {
    this.activitySources.push(source);
  }
  registerBadgeSource(source: BadgeSource) {
    this.badgeSources.push(source);
  }

  // ------------------------------------------------------------------ config & preferences

  async config(userId: string): Promise<NotificationsConfig> {
    if (!this.sender.configured) return { available: false };
    const access = await this.accessFor(userId);
    return access?.push && access.social
      ? { available: true, publicKey: this.sender.publicKey }
      : { available: false };
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const row = await this.preferences.findOne({ userId }).lean();
    return this.preferencesDto(row);
  }

  async updatePreferences(
    userId: string,
    dto: {
      enabled?: boolean;
      types?: Partial<Record<NotificationType, boolean>>;
      showCommentPreviews?: boolean;
      showMessagePreviews?: boolean;
    },
  ): Promise<NotificationPreferences> {
    const set: Record<string, unknown> = {};
    if (dto.enabled !== undefined) set['enabled'] = dto.enabled;
    if (dto.showCommentPreviews !== undefined)
      set['showCommentPreviews'] = dto.showCommentPreviews;
    if (dto.showMessagePreviews !== undefined)
      set['showMessagePreviews'] = dto.showMessagePreviews;
    for (const [type, value] of Object.entries(dto.types ?? {}))
      if (value !== undefined) set[`types.${type}`] = value;
    // Only userId is seeded on insert, so no field appears in both operators (CLAUDE.md).
    const row = await this.preferences
      .findOneAndUpdate(
        { userId },
        { ...(Object.keys(set).length ? { $set: set } : {}), $setOnInsert: { userId } },
        { upsert: true, new: true },
      )
      .lean();
    return this.preferencesDto(row);
  }

  async dismissOffer(userId: string): Promise<NotificationPreferences> {
    const row = await this.preferences
      .findOneAndUpdate(
        { userId },
        { $set: { offerDismissedAt: this.now() }, $setOnInsert: { userId } },
        { upsert: true, new: true },
      )
      .lean();
    return this.preferencesDto(row);
  }

  private preferencesDto(
    row: Partial<NotificationPreferencesRecord> | null,
  ): NotificationPreferences {
    const hiddenUntil = row?.offerDismissedAt
      ? new Date(row.offerDismissedAt.getTime() + OFFER_PAUSE_MS)
      : undefined;
    return {
      enabled: row?.enabled === true,
      types: Object.fromEntries(
        NOTIFICATION_TYPES.map((type) => [type, typeEnabled(row ?? undefined, type)]),
      ) as Record<NotificationType, boolean>,
      showCommentPreviews: row?.showCommentPreviews === true,
      showMessagePreviews: row?.showMessagePreviews === true,
      ...(hiddenUntil && hiddenUntil > this.now()
        ? { offerHiddenUntil: hiddenUntil.toISOString() }
        : {}),
    };
  }

  // ------------------------------------------------------------------ devices

  async registerDevice(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    label: string,
    enable: boolean,
  ): Promise<{ id: string }> {
    const now = this.now();
    // Upsert by endpoint: a device signed in by someone new moves to them (FR-008).
    const device = await this.devices
      .findOneAndUpdate(
        { endpoint: subscription.endpoint },
        {
          $set: { userId, keys: subscription.keys, label, lastUsedAt: now },
          $setOnInsert: { endpoint: subscription.endpoint },
        },
        { upsert: true, new: true },
      )
      .lean();
    const extra = await this.devices
      .find({ userId })
      .sort({ lastUsedAt: -1 })
      .skip(MAX_DEVICES)
      .select('_id')
      .lean();
    if (extra.length)
      await this.devices.deleteMany({ _id: { $in: extra.map((d) => d._id) } });
    if (enable) {
      // Turning notifications on from a tap enables them; a background re-sync never does.
      await this.preferences.updateOne(
        { userId },
        { $set: { enabled: true }, $setOnInsert: { userId } },
        { upsert: true },
      );
    }
    if (!device) throw new NotFoundException('Device not found.');
    return { id: String(device._id) };
  }

  async listDevices(userId: string): Promise<PushDeviceSummary[]> {
    const rows = await this.devices
      .find({ userId })
      .sort({ lastUsedAt: -1 })
      .select('label createdAt lastUsedAt')
      .lean();
    return rows.map((row) => ({
      id: String(row._id),
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
    }));
  }

  async removeDevice(userId: string, id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException('Device not found.');
    const result = await this.devices.deleteOne({ _id: id, userId });
    if (!result.deletedCount) throw new NotFoundException('Device not found.');
    return { success: true };
  }

  async unregister(userId: string, endpoint: string) {
    await this.devices.deleteOne({ userId, endpoint });
    return { success: true };
  }

  // ------------------------------------------------------------------ sending

  /**
   * Sends one event to every device of its recipient. Callers do not await it and it never
   * rejects: a failing push service must not fail the like, comment or request (SC-007).
   */
  async notify(event: NotificationEvent): Promise<void> {
    try {
      await this.deliver(event);
    } catch (error) {
      this.logger.warn(
        `Notification ${event.type} not sent: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private async deliver(event: NotificationEvent) {
    const def = this.types.get(event.type);
    if (!def || !this.sender.configured) return;
    const [prefs, recipientAccess, actorAccess, connection] = await Promise.all([
      this.preferences.findOne({ userId: event.recipientId }).lean(),
      this.accessFor(event.recipientId),
      this.accessFor(event.actorId),
      event.actorId === event.recipientId
        ? null
        : this.graph.between(event.actorId, event.recipientId),
    ]);
    if (!recipientAccess || !actorAccess) return;
    const skip = shouldNotify({
      event,
      prefs: prefs ?? undefined,
      requires: def.requires,
      recipientAccess,
      actorAccess,
      connection,
      selfAllowed: def.selfAllowed,
    });
    if (skip) return;
    if (def.canStillSee && !(await def.canStillSee(event))) return;
    if (def.suppress && (await def.suppress(event))) return;
    const devices = await this.devices.find({ userId: event.recipientId }).lean();
    if (!devices.length) return;
    const key = def.collapseKey(event);
    const others = await this.collapse(event, key, def.windowMs);
    if (others === null) return;
    const text = notificationText(event, {
      showCommentPreviews: prefs?.showCommentPreviews === true,
      showMessagePreviews: prefs?.showMessagePreviews === true,
      others,
    });
    const payload = {
      ...text,
      url: def.url(event),
      tag: notificationTag(event.type, key),
      badge: await this.badgeCount(event.recipientId),
    };
    await Promise.all(
      devices.map(async (device) => {
        const result = await this.sender.send(device, payload);
        if (result === 'gone')
          await this.devices.deleteOne({ _id: device._id, endpoint: device.endpoint });
        else if (result === 'ok')
          await this.devices.updateOne(
            { _id: device._id },
            { $set: { lastSuccessAt: this.now() } },
          );
      }),
    );
  }

  /**
   * Atomic collapse step (research R4). Returns how many sends were skipped since the last
   * one, or `null` when this one falls inside the window and must not be sent.
   */
  private async collapse(
    event: NotificationEvent,
    collapseKey: string,
    windowMs: number,
  ): Promise<number | null> {
    if (windowMs <= 0) return 0;
    const now = this.now();
    const key = { recipientId: event.recipientId, type: event.type, collapseKey };
    for (let attempt = 0; attempt < 2; attempt++) {
      const due = await this.deliveries
        .findOneAndUpdate(
          { ...key, lastSentAt: { $lte: collapseCutoff(now, windowMs) } },
          { $set: { lastSentAt: now, suppressed: 0 } },
        )
        .lean();
      if (due) return due.suppressed;
      const inside = await this.deliveries.updateOne(key, { $inc: { suppressed: 1 } });
      if (inside.matchedCount) return null;
      try {
        await this.deliveries.create({ ...key, lastSentAt: now, suppressed: 0 });
        return 0;
      } catch (error) {
        // Another like arrived at the same moment and created the row first: decide again.
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
    return null;
  }

  private async accessFor(userId: string): Promise<FeatureAccess | null> {
    try {
      return (await this.access.forUser(userId)).access;
    } catch (error) {
      if (error instanceof UnauthorizedException) return null;
      throw error;
    }
  }

  // ------------------------------------------------------------------ activity & badge

  private floor(): Date {
    return new Date(this.now().getTime() - ACTIVITY_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * Rows from every source, without the member's own actions or anyone blocked. A type that is
   * about the member's own doing (`selfAllowed`, e.g. a badge) is the exception.
   */
  private async rows(userId: string, since: Date, before: Date | undefined, limit: number) {
    const [blocked, ...batches] = await Promise.all([
      this.graph.blockedUserIds(userId),
      ...this.activitySources.map((source) => source.rows(userId, since, before, limit)),
    ]);
    const hidden = new Set(blocked);
    return {
      full: batches.some((batch) => batch.length >= limit),
      rows: batches
        .flat()
        .filter(
          (row) =>
            (row.actorId !== userId || this.types.get(row.type)?.selfAllowed) &&
            !hidden.has(row.actorId),
        ),
    };
  }

  async activity(userId: string, before?: Date): Promise<ActivityPage> {
    const [prefs, { rows, full }] = await Promise.all([
      this.preferences.findOne({ userId }).select('activitySeenAt').lean(),
      this.rows(userId, this.floor(), before, PER_SOURCE),
    ]);
    const grouped = groupActivity(rows, prefs?.activitySeenAt);
    const items = grouped.slice(0, PAGE);
    const last = items[items.length - 1];
    return {
      items,
      ...(last && (grouped.length > PAGE || full) ? { nextBefore: last.createdAt } : {}),
    };
  }

  /** The icon badge: unseen Activity items plus any module's own unread count. */
  async badgeCount(userId: string): Promise<number> {
    const prefs = await this.preferences
      .findOne({ userId })
      .select('activitySeenAt')
      .lean();
    const seenAt = prefs?.activitySeenAt;
    const floor = this.floor();
    const since = seenAt && seenAt > floor ? seenAt : floor;
    const [{ rows }, ...extra] = await Promise.all([
      this.rows(userId, since, undefined, 100),
      ...this.badgeSources.map((source) => source.unseen(userId)),
    ]);
    return (
      groupActivity(rows, seenAt).filter((item) => item.unseen).length +
      extra.reduce((sum, n) => sum + n, 0)
    );
  }

  async markSeen(userId: string) {
    await this.preferences.updateOne(
      { userId },
      { $set: { activitySeenAt: this.now() }, $setOnInsert: { userId } },
      { upsert: true },
    );
    return { count: await this.badgeCount(userId) };
  }
}
