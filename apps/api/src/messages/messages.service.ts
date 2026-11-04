import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  MESSAGE_PAGE,
  MESSAGE_RATE_PER_MINUTE,
  type CannotSendReason,
  type ChatMessage,
  type ChatPerson,
  type ConversationView,
  type FeatureAccess,
  type InboxEntry,
  type MessagesPage,
  type SharedPostCard,
  type SyncResult,
} from '@life-portal/shared-types';
import {
  canMessage,
  isViewing,
  messagePreview,
  pairKey,
} from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { NotificationsService } from '../notifications/notifications.service';
import { PostsService } from '../posts/posts.service';
import { SocialGraphService } from '../social-graph/social-graph.module';
import { SocialService } from '../social/social.module';
import { Conversation, ConversationMember, Message } from './messages.schemas';

type ConversationRow = Conversation & { _id: Types.ObjectId };
type MessageRow = Message & { _id: Types.ObjectId };

const INBOX_LIMIT = 50;
const UNREAD_CAP = 99;

const CANNOT_SEND: Record<CannotSendReason, string> = {
  'not-friends': 'You can message friends only.',
  blocked: 'You can’t message this person.',
  feature: 'Messages aren’t available for this conversation.',
};

/** Thrown when a member sends faster than MESSAGE_RATE_PER_MINUTE. */
class TooFast extends HttpException {
  constructor() {
    super('You’re sending messages too fast. Wait a moment.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class MessagesService implements OnModuleInit {
  /** Injectable for tests. */
  now: () => Date = () => new Date();

  constructor(
    @InjectModel(Conversation.name) private readonly conversations: Model<Conversation>,
    @InjectModel(Message.name) private readonly messages: Model<Message>,
    private readonly graph: SocialGraphService,
    private readonly access: AccessService,
    private readonly social: SocialService,
    private readonly posts: PostsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The `message` notification type and the unread badge (docs/modules/notifications.md). */
  onModuleInit() {
    this.notifications.register({
      type: 'message',
      requires: ['messages'],
      windowMs: 0,
      // One notification per conversation: a newer one replaces the older on the device.
      collapseKey: (event) => event.targetId,
      url: (event) => `/messages/${event.targetId}`,
      suppress: async (event) => {
        const conversation = await this.conversations
          .findOne({ _id: event.targetId, memberIds: event.recipientId })
          .lean();
        const member = conversation?.members.find((m) => m.userId === event.recipientId);
        return !member || member.muted === true || isViewing(member.viewingAt, this.now());
      },
    });
    this.notifications.registerBadgeSource({ unseen: (userId) => this.unreadCount(userId) });
  }

  // ------------------------------------------------------------------ access

  private async accessFor(userId: string): Promise<FeatureAccess | null> {
    try {
      return (await this.access.forUser(userId)).access;
    } catch (error) {
      if (error instanceof UnauthorizedException) return null;
      throw error;
    }
  }

  private async cannotSend(a: string, b: string): Promise<CannotSendReason | null> {
    const [connection, accessA, accessB] = await Promise.all([
      this.graph.between(a, b),
      this.accessFor(a),
      this.accessFor(b),
    ]);
    return canMessage({ connection, accessA, accessB });
  }

  /** Membership is part of every lookup: someone else's conversation looks like none at all. */
  private async mine(userId: string, id: string): Promise<ConversationRow> {
    if (!isValidObjectId(id)) throw new NotFoundException('Conversation not found.');
    const row = await this.conversations.findOne({ _id: id, memberIds: userId }).lean();
    if (!row) throw new NotFoundException('Conversation not found.');
    return row;
  }

  private member(row: ConversationRow, userId: string): ConversationMember | undefined {
    return row.members.find((m) => m.userId === userId);
  }

  private other(row: ConversationRow, userId: string): string {
    return row.memberIds.find((id) => id !== userId) ?? userId;
  }

  private async people(userIds: string[]): Promise<Map<string, ChatPerson>> {
    return this.social.authors(userIds);
  }

  private person(people: Map<string, ChatPerson>, userId: string): ChatPerson {
    return people.get(userId) ?? { userId: '', displayName: 'Former member', username: '' };
  }

  // ------------------------------------------------------------------ conversations

  /** Get or create the one conversation with a friend (spec FR-002). */
  async open(userId: string, otherId: string): Promise<{ id: string }> {
    if (userId === otherId) throw new BadRequestException('Choose a friend to message.');
    const reason = await this.cannotSend(userId, otherId);
    if (reason) throw new ForbiddenException(CANNOT_SEND[reason]);
    const pair = pairKey(userId, otherId);
    const memberIds = [userId, otherId].sort();
    const filter = { kind: 'direct' as const, pair };
    try {
      await this.conversations.updateOne(
        filter,
        {
          $setOnInsert: {
            ...filter,
            memberIds,
            members: memberIds.map((id) => ({ userId: id })),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      // Both friends tapped Message at once; the other insert won.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const row = await this.conversations.findOne(filter).select('_id').lean();
    if (!row) throw new NotFoundException('Conversation not found.');
    return { id: String(row._id) };
  }

  async view(userId: string, id: string): Promise<ConversationView> {
    const row = await this.mine(userId, id);
    const otherId = this.other(row, userId);
    const [people, reason] = await Promise.all([
      this.people([otherId]),
      this.cannotSend(userId, otherId),
    ]);
    const otherLastReadAt = this.member(row, otherId)?.lastReadAt;
    return {
      id: String(row._id),
      other: this.person(people, otherId),
      canSend: !reason,
      ...(reason ? { cannotSendReason: reason } : {}),
      muted: this.member(row, userId)?.muted === true,
      ...(otherLastReadAt ? { otherLastReadAt: otherLastReadAt.toISOString() } : {}),
    };
  }

  async mute(userId: string, id: string, muted: boolean) {
    await this.mine(userId, id);
    await this.conversations.updateOne(
      { _id: id, 'members.userId': userId },
      { $set: { 'members.$.muted': muted } },
    );
    return { muted };
  }

  // ------------------------------------------------------------------ messages

  private async card(viewerId: string, postId: string): Promise<SharedPostCard> {
    try {
      // The same authorization as opening the post: audience, friendship, blocks, deletion.
      const post = await this.posts.detail(viewerId, postId);
      return {
        id: post.id,
        title: post.title || post.contentLabel || clipCaption(post.caption) || 'Post',
        authorName: post.author.displayName,
        ...(post.kind && post.totalKcal !== undefined && post.totalKcal !== null
          ? { totalKcal: post.totalKcal }
          : {}),
        ...(post.media[0]
          ? { thumbnailUrl: post.media[0].posterUrl ?? post.media[0].url }
          : {}),
      };
    } catch {
      return { unavailable: true };
    }
  }

  private async dto(row: MessageRow, viewerId: string): Promise<ChatMessage> {
    const mine = row.senderId === viewerId;
    const base = {
      id: String(row._id),
      ...(mine ? { requestId: row.requestId } : {}),
      mine,
      createdAt: row.createdAt.toISOString(),
    };
    if (row.unsentAt) return { ...base, kind: 'unsent' };
    if (row.kind === 'post' && row.postId)
      return { ...base, kind: 'post', post: await this.card(viewerId, row.postId) };
    return { ...base, kind: 'text', text: row.text ?? '' };
  }

  async page(userId: string, id: string, before?: string): Promise<MessagesPage> {
    await this.mine(userId, id);
    const rows = await this.messages
      .find({ conversationId: id, ...(before ? { _id: { $lt: before } } : {}) })
      .sort({ _id: -1 })
      .limit(MESSAGE_PAGE + 1)
      .lean();
    const page = rows.slice(0, MESSAGE_PAGE);
    const messages = await Promise.all(page.reverse().map((row) => this.dto(row, userId)));
    return {
      messages,
      ...(rows.length > MESSAGE_PAGE ? { nextBefore: messages[0].id } : {}),
    };
  }

  /**
   * The open conversation's poll (research R1): new messages, recent unsends and the other
   * member's read time. Calling it records that the caller has read and is viewing it.
   */
  async sync(
    userId: string,
    id: string,
    after?: string,
    since?: string,
  ): Promise<SyncResult> {
    const row = await this.mine(userId, id);
    const now = this.now();
    const otherId = this.other(row, userId);
    await this.conversations.updateOne(
      { _id: id, 'members.userId': userId },
      { $set: { 'members.$.lastReadAt': now, 'members.$.viewingAt': now } },
    );
    const [fresh, unsent, reason] = await Promise.all([
      after
        ? this.messages
            .find({ conversationId: id, _id: { $gt: after } })
            .sort({ _id: 1 })
            .limit(100)
            .lean()
        : Promise.resolve([] as MessageRow[]),
      since
        ? this.messages
            .find({ conversationId: id, unsentAt: { $gte: new Date(since) } })
            .select('_id')
            .lean()
        : Promise.resolve([] as { _id: Types.ObjectId }[]),
      this.cannotSend(userId, otherId),
    ]);
    const otherLastReadAt = this.member(row, otherId)?.lastReadAt;
    return {
      messages: await Promise.all(fresh.map((m) => this.dto(m, userId))),
      unsentIds: unsent.map((m) => String(m._id)),
      ...(otherLastReadAt ? { otherLastReadAt: otherLastReadAt.toISOString() } : {}),
      canSend: !reason,
      serverTime: now.toISOString(),
    };
  }

  async send(
    userId: string,
    id: string,
    dto: { requestId: string; text?: string; postId?: string },
  ): Promise<ChatMessage> {
    const row = await this.mine(userId, id);
    const filter = { conversationId: id, senderId: userId, requestId: dto.requestId };
    // A retry of something already stored returns it, even if the friendship changed since.
    const existing = await this.messages.findOne(filter).lean();
    if (existing) return this.dto(existing, userId);

    if ((dto.text === undefined) === (dto.postId === undefined))
      throw new BadRequestException('Send either a message or a post.');
    const otherId = this.other(row, userId);
    const reason = await this.cannotSend(userId, otherId);
    if (reason) throw new ForbiddenException(CANNOT_SEND[reason]);
    const now = this.now();
    const recent = await this.messages.countDocuments({
      senderId: userId,
      createdAt: { $gte: new Date(now.getTime() - 60_000) },
    });
    if (recent >= MESSAGE_RATE_PER_MINUTE) throw new TooFast();
    if (dto.postId) {
      const card = await this.card(userId, dto.postId);
      if ('unavailable' in card)
        throw new BadRequestException('You can only send posts you can see.');
    }
    const text = dto.text?.trim();
    const result = await this.messages
      .updateOne(
        filter,
        {
          $setOnInsert: {
            ...filter,
            kind: dto.postId ? 'post' : 'text',
            ...(dto.postId ? { postId: dto.postId } : { text }),
            createdAt: now,
          },
        },
        { upsert: true },
      )
      .catch((error: { code?: number }) => {
        if (error.code === 11000) return { upsertedCount: 0 };
        throw error;
      });
    const stored = await this.messages.findOne(filter).lean();
    if (!stored) throw new NotFoundException('Message not found.');
    if (result.upsertedCount) {
      // Sending means the sender has read everything before it.
      await this.conversations.updateOne(
        { _id: id, 'members.userId': userId },
        { $set: { 'members.$.lastReadAt': now, 'members.$.viewingAt': now } },
      );
      const actor = await this.social.own(userId);
      // Not awaited: a failing push service never fails the send.
      void this.notifications.notify({
        type: 'message',
        recipientId: otherId,
        actorId: userId,
        actorName: actor.displayName,
        targetId: id,
        messageKind: stored.kind,
        ...(stored.text ? { messageText: stored.text } : {}),
      });
    }
    return this.dto(stored, userId);
  }

  /** Erases the content for both members; only the sender can (spec FR-006). */
  async unsend(userId: string, id: string, messageId: string) {
    await this.mine(userId, id);
    if (!isValidObjectId(messageId)) throw new NotFoundException('Message not found.');
    const result = await this.messages.updateOne(
      { _id: messageId, conversationId: id, senderId: userId },
      { $set: { unsentAt: this.now() }, $unset: { text: '', postId: '' } },
    );
    if (!result.matchedCount) throw new NotFoundException('Message not found.');
    return { success: true };
  }

  // ------------------------------------------------------------------ inbox

  private unreadFilter(conversationId: string, userId: string, since?: Date) {
    return {
      conversationId,
      senderId: { $ne: userId },
      unsentAt: { $exists: false },
      ...(since ? { createdAt: { $gt: since } } : {}),
    };
  }

  /** Newest conversations first, derived from their latest messages (research R3). */
  async inbox(userId: string): Promise<InboxEntry[]> {
    const rows = await this.conversations.find({ memberIds: userId }).limit(500).lean();
    if (!rows.length) return [];
    const ids = rows.map((r) => String(r._id));
    const lasts = await this.messages.aggregate<{ _id: string; last: MessageRow }>([
      { $match: { conversationId: { $in: ids } } },
      { $sort: { conversationId: 1, _id: -1 } },
      { $group: { _id: '$conversationId', last: { $first: '$$ROOT' } } },
    ]);
    const lastBy = new Map(lasts.map((l) => [l._id, l.last]));
    const entries = rows
      .flatMap((row) => {
        const last = lastBy.get(String(row._id));
        return last ? [{ row, last }] : [];
      })
      .sort((a, b) => b.last.createdAt.getTime() - a.last.createdAt.getTime())
      .slice(0, INBOX_LIMIT);
    const people = await this.people(entries.map(({ row }) => this.other(row, userId)));
    return Promise.all(
      entries.map(async ({ row, last }) => {
        const id = String(row._id);
        const unread = await this.messages.countDocuments(
          this.unreadFilter(id, userId, this.member(row, userId)?.lastReadAt),
          { limit: UNREAD_CAP },
        );
        return {
          id,
          other: this.person(people, this.other(row, userId)),
          preview: messagePreview({
            kind: last.kind,
            text: last.text,
            unsent: !!last.unsentAt,
            fromMe: last.senderId === userId,
          }),
          lastMessageAt: last.createdAt.toISOString(),
          unread,
        };
      }),
    );
  }

  /** Conversations with at least one unread message: the header icon and badge. */
  async unreadCount(userId: string): Promise<number> {
    const rows = await this.conversations.find({ memberIds: userId }).limit(500).lean();
    const flags = await Promise.all(
      rows.map((row) =>
        this.messages.exists(
          this.unreadFilter(String(row._id), userId, this.member(row, userId)?.lastReadAt),
        ),
      ),
    );
    return flags.filter(Boolean).length;
  }
}

/** A text-only post's card title: its first line, cut short. */
function clipCaption(caption: string): string {
  const line = caption.trim().split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}
