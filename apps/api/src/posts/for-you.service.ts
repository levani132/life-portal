import { CONFIG, type AppConfig } from '../config/configuration';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import type { FoodPost, ForYouReason, PostPage } from '@life-portal/shared-types';
import {
  FOR_YOU_CONFIG,
  forYouReasonText,
  postTopics,
  rankForYou,
  signalSince,
  type RankCandidate,
  type RankedEntry,
  type ViewerInteraction,
} from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { PostCommentRecord, PostLikeRecord } from './post-engagement.service';
import { PostsService } from './posts.service';
import { FoodPostRecord, ForYouSessionRecord } from './posts.schemas';
import type { ForYouDto } from './posts.dto';

type PostRow = FoodPostRecord & { _id: Types.ObjectId };
const ORIGINAL = { repostOf: { $exists: false } };
/** A ranked session lasts this long; its rows are deleted by Mongo's TTL monitor after. */
export const FOR_YOU_SESSION_MS = 30 * 60_000;
/** Newest eligible posts read for one session, before the 300 the ranking keeps. */
const POOL_SCAN = 400;
/** At most this many of each kind of the viewer's own interactions are read. */
const SIGNAL_LIMIT = 500;

/** What #10 will supply: chosen interest topics and a "Reset recommendations" time. */
export interface ForYouPreferences {
  interestTopicIds?: string[];
  resetAt?: string;
}

/**
 * Ranked For You (#9), behind `forYouRanking`. Without the flag, `GET /posts/for-you` is the
 * unchanged newest-first feed in `PostsService.forYou`.
 *
 * A first page builds a session: the newest eligible public posts (the same exclusions as the
 * plain feed, applied before scoring), the viewer's own likes, comments and reposts from the last
 * 90 days, and each candidate's engaged-member count, ranked by the pure `rankForYou`. Only the
 * order and reason codes are stored (`for_you_sessions`, 30 minutes). Later pages walk that order
 * and re-check every post now, so a post deleted, made private, blocked, reported or marked Not
 * interested mid-session simply drops out, and nothing repeats or is skipped.
 */
@Injectable()
export class ForYouService {
  constructor(
    @InjectModel(FoodPostRecord.name) private readonly posts: Model<FoodPostRecord>,
    @InjectModel(PostLikeRecord.name) private readonly likes: Model<PostLikeRecord>,
    @InjectModel(PostCommentRecord.name) private readonly comments: Model<PostCommentRecord>,
    @InjectModel(ForYouSessionRecord.name) private readonly sessions: Model<ForYouSessionRecord>,
    private readonly feed: PostsService,
    private readonly access: AccessService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async page(userId: string, query: ForYouDto, now = new Date()): Promise<PostPage> {
    const { access } = await this.access.forUser(userId);
    if (!access.forYouRanking) return this.feed.forYou(userId, query);
    await this.feed.forYouGate(userId);
    if (!query.cursor) {
      const session = await this.build(userId, now);
      return this.serve(userId, session, 0);
    }
    const cursor = this.decode(query.cursor);
    const session = await this.sessions.findOne({ userId, seed: cursor.seed }).lean();
    if (!session || session.expiresAt.getTime() <= now.getTime()) return { posts: [], expired: true };
    return this.serve(userId, session, cursor.offset);
  }

  /** The preferences #10 will store; until then none, and ranking works without them. */
  async preferences(_userId: string): Promise<ForYouPreferences> {
    return {};
  }

  private async build(userId: string, now: Date) {
    const filter = await this.feed.forYouFilter(userId);
    const rows: PostRow[] = await this.posts
      .find(this.feed.forYouQuery(filter.excluded))
      .sort({ createdAt: -1, _id: -1 })
      .limit(POOL_SCAN)
      .lean();
    const pool = (await this.feed.forYouEligible(userId, rows, filter)).slice(0, FOR_YOU_CONFIG.sessionSize);
    const preferences = await this.preferences(userId);
    const [interactions, engaged] = await Promise.all([
      this.interactions(userId, signalSince(now.toISOString(), preferences.resetAt)),
      this.engagedMembers(pool, userId, filter.graphHidden),
    ]);
    const candidates: RankCandidate[] = pool.map((row) => ({
      id: String(row._id),
      authorId: row.userId,
      createdAt: row.createdAt.toISOString(),
      topicIds: postTopics({ caption: row.caption, publication: row.publication }).map((topic) => topic.id),
      engagedMembers: engaged.get(String(row._id)) ?? 0,
    }));
    const seed = randomBytes(12).toString('base64url');
    const ranking = rankForYou({
      viewerId: userId,
      candidates,
      interactions,
      interestTopicIds: preferences.interestTopicIds,
      resetAt: preferences.resetAt,
      now: now.toISOString(),
      seed,
    });
    const session = {
      userId,
      seed,
      mode: ranking.mode,
      entries: ranking.entries,
      expiresAt: new Date(now.getTime() + FOR_YOU_SESSION_MS),
    };
    // One row per viewer: a new first page replaces the last session.
    await this.sessions.deleteMany({ userId });
    await this.sessions.create(session);
    return session;
  }

  /**
   * The viewer's own likes, comments and reposts since `since`, each with the post's author and
   * topics. Interactions with posts now deleted are dropped. Never imports, food logs or health.
   */
  async interactions(userId: string, since: string): Promise<ViewerInteraction[]> {
    const after = { $gte: new Date(since) };
    const [likes, comments, reposts] = await Promise.all([
      this.likes.find({ userId, createdAt: after }).sort({ createdAt: -1 }).limit(SIGNAL_LIMIT).select('postId createdAt').lean(),
      this.comments
        .find({ userId, deleted: { $ne: true }, createdAt: after })
        .sort({ createdAt: -1 })
        .limit(SIGNAL_LIMIT)
        .select('postId createdAt')
        .lean(),
      this.posts
        .find({ userId, repostOf: { $exists: true }, deleted: { $ne: true }, createdAt: after })
        .sort({ createdAt: -1 })
        .limit(SIGNAL_LIMIT)
        .select('repostOf createdAt')
        .lean(),
    ]);
    const raw = [
      ...likes.map((row) => ({ postId: row.postId, at: (row as { createdAt: Date }).createdAt, kind: 'like' as const })),
      ...comments.map((row) => ({ postId: row.postId, at: (row as { createdAt: Date }).createdAt, kind: 'comment' as const })),
      ...reposts.map((row) => ({ postId: row.repostOf as string, at: row.createdAt, kind: 'repost' as const })),
    ];
    const ids = [...new Set(raw.map((item) => item.postId))].filter((id) => Types.ObjectId.isValid(id));
    const targets: PostRow[] = ids.length
      ? await this.posts
          .find({ _id: { $in: ids }, deleted: { $ne: true }, ...ORIGINAL })
          .select('userId caption publication')
          .lean()
      : [];
    const byId = new Map(
      targets.map((row) => [
        String(row._id),
        { authorId: row.userId, topicIds: postTopics({ caption: row.caption, publication: row.publication }).map((t) => t.id) },
      ]),
    );
    return raw.flatMap((item) => {
      const target = byId.get(item.postId);
      return target ? [{ postId: item.postId, kind: item.kind, at: item.at.toISOString(), ...target }] : [];
    });
  }

  /**
   * Distinct members other than the author and the viewer who liked, commented on or reposted
   * each post; members the viewer blocked or muted don't count. Each member counts once per post.
   */
  async engagedMembers(rows: PostRow[], viewerId: string, hidden: ReadonlySet<string>): Promise<Map<string, number>> {
    const ids = rows.map((row) => String(row._id));
    if (!ids.length) return new Map();
    const [likes, comments, reposts] = await Promise.all([
      this.likes.find({ postId: { $in: ids } }).select('postId userId').lean(),
      this.comments.find({ postId: { $in: ids }, deleted: { $ne: true } }).select('postId userId').lean(),
      this.posts.find({ repostOf: { $in: ids }, deleted: { $ne: true } }).select('repostOf userId').lean(),
    ]);
    const authorOf = new Map(rows.map((row) => [String(row._id), row.userId]));
    const members = new Map<string, Set<string>>();
    for (const { postId, userId } of [
      ...likes,
      ...comments,
      ...reposts.map((row) => ({ postId: row.repostOf as string, userId: row.userId })),
    ]) {
      if (userId === viewerId || userId === authorOf.get(postId) || hidden.has(userId)) continue;
      const set = members.get(postId) ?? new Set<string>();
      set.add(userId);
      members.set(postId, set);
    }
    return new Map([...members].map(([postId, set]) => [postId, set.size]));
  }

  private async serve(
    userId: string,
    session: { seed: string; entries: RankedEntry[] },
    offset: number,
  ): Promise<PostPage> {
    const pageSize = FOR_YOU_CONFIG.pageSize;
    const posts: FoodPost[] = [];
    const filter = await this.feed.forYouFilter(userId);
    let index = offset;
    while (posts.length < pageSize && index < session.entries.length) {
      const chunk = session.entries.slice(index, index + pageSize * 2);
      const rows: PostRow[] = await this.posts
        .find({ _id: { $in: chunk.map((entry) => entry.postId) }, deleted: { $ne: true }, ...ORIGINAL })
        .lean();
      const eligible = new Map(
        (await this.feed.forYouEligible(userId, rows, filter)).map((row) => [String(row._id), row]),
      );
      for (const entry of chunk) {
        index += 1;
        const row = eligible.get(entry.postId);
        const card = row && (await this.feed.forYouCard(userId, row));
        if (!card) continue;
        posts.push({ ...card, reasons: this.reasons(entry, card) });
        if (posts.length === pageSize) break;
      }
    }
    return {
      posts,
      ...(index < session.entries.length ? { nextCursor: this.encode({ seed: session.seed, offset: index }) } : {}),
    };
  }

  private reasons(entry: RankedEntry, card: FoodPost): ForYouReason[] {
    return entry.reasons.flatMap((reason) => {
      const text = forYouReasonText(reason, {
        topicLabel: card.topics.find((topic) => topic.id === reason.topicId)?.label,
        authorName: card.author.displayName,
      });
      return text ? [{ code: reason.code, ...(reason.topicId ? { topicId: reason.topicId } : {}), text }] : [];
    });
  }

  private key() {
    return createHash('sha256').update(this.config.jwtSecret).update('for-you-ranked-cursor').digest();
  }

  private encode(cursor: { seed: string; offset: number }) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(cursor)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }

  private decode(value: string): { seed: string; offset: number } {
    try {
      const bytes = Buffer.from(value, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key(), bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const parsed = JSON.parse(
        Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
      ) as { seed: unknown; offset: unknown };
      if (typeof parsed.seed !== 'string' || !Number.isInteger(parsed.offset) || (parsed.offset as number) < 0) {
        throw new Error();
      }
      return { seed: parsed.seed, offset: parsed.offset as number };
    } catch {
      throw new BadRequestException('Invalid feed cursor.');
    }
  }
}
