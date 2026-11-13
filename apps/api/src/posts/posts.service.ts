import { CONFIG, type AppConfig } from '../config/configuration';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { isValidObjectId, Model, Types } from 'mongoose';
import type {
  FoodPost,
  PostAuthor,
  PublicPostPreview,
  PostPage,
  PostPreview,
  PostReport,
} from '@life-portal/shared-types';
import {
  canReadFoodPost,
  canRepost,
  canonicalPublication,
  postHasContent,
  publicationCalories,
  publicationMacros,
  postTopics,
} from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { NutritionPublicationService } from '../nutrition/nutrition-publication.service';
import { SocialService } from '../social/social.module';
import { SocialGraphService } from '../social-graph/social-graph.module';
import { MediaService } from '../media/media.service';
import {
  FeedFeedbackRecord,
  FoodPostRecord,
  PostReportRecord,
  type FeedFeedbackKind,
} from './posts.schemas';
import type {
  CreatePostDto,
  ForYouDto,
  ImportPostDto,
  PostListDto,
  PreviewPostDto,
  ReportPostDto,
  UpdatePostDto,
} from './posts.dto';

/** Matches posts, not reposts. A repost row is never addressable by its own id. */
const ORIGINAL = { repostOf: { $exists: false } };
const repostRequest = (postId: string) => `repost:${postId}`;
type PostRow = FoodPostRecord & { _id: Types.ObjectId };
type Feed = 'wall' | 'forYou';
/** For You shows at most this many posts by one author on a page; the rest are skipped. */
export const FOR_YOU_AUTHOR_CAP = 2;
const PAGE_SIZE = 10;
const SCAN_BATCH = 25;
const SCAN_LIMIT = 100;

@Injectable()
export class PostsService {
  constructor(
    @InjectModel(FoodPostRecord.name)
    private readonly posts: Model<FoodPostRecord>,
    @InjectModel(PostReportRecord.name)
    private readonly reports: Model<PostReportRecord>,
    private readonly access: AccessService,
    private readonly nutrition: NutritionPublicationService,
    private readonly social: SocialService,
    private readonly graph: SocialGraphService,
    private readonly media: MediaService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @InjectModel(FeedFeedbackRecord.name)
    private readonly feedback: Model<FeedFeedbackRecord>,
  ) {}

  /**
   * The (UTC) creation day of each original, live post, for profile badges (spec 022). Reposts and
   * removed posts do not count.
   */
  async originalPostDays(userId: string): Promise<string[]> {
    const rows = await this.posts
      .find({ userId, deleted: false, ...ORIGINAL })
      .select('createdAt')
      .lean<{ createdAt: Date }[]>();
    return rows.map((row) => row.createdAt.toISOString().slice(0, 10));
  }
  private id(id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException('Post not found.');
    return id;
  }
  private async enabled(userId: string): Promise<boolean> {
    try {
      const { access } = await this.access.forUser(userId);
      return access.social && access.nutrition && access.foodPosts;
    } catch (error) {
      if (error instanceof UnauthorizedException) return false;
      throw error;
    }
  }
  private async requireEnabled(userId: string) {
    await Promise.all(
      ['social', 'nutrition', 'foodPosts'].map((id) =>
        this.access.require(userId, id as 'social' | 'nutrition' | 'foodPosts'),
      ),
    );
  }
  async preview(userId: string, dto: PreviewPostDto): Promise<PostPreview> {
    await this.requireEnabled(userId);
    if (!dto.source) throw new BadRequestException('Choose what to share.');
    const publication = await this.nutrition.snapshot(userId, dto.source);
    return {
      publication,
      previewHash: createHash('sha256')
        .update(canonicalPublication(publication))
        .digest('hex'),
    };
  }
  /** Only ever called after the viewer has passed `readable()`: it signs the media links. */
  private async dto(
    row: FoodPostRecord & { _id: Types.ObjectId },
    author: PostAuthor,
    viewerId: string,
    teaser: boolean,
  ): Promise<FoodPost> {
    const p = row.publication;
    const base = {
      id: String(row._id),
      author,
      title: row.title,
      caption: row.caption,
      audience: row.audience,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: 1 as const,
      media: await this.media.sign(row.media),
      // From the whole publication, never the feed teaser, and from published content only.
      topics: postTopics({ caption: row.caption, publication: p }),
      isOwner: row.userId === viewerId,
    };
    // A post without food: text and/or photos only.
    if (!p) return { ...base, itemCount: 0, items: [] };
    return {
      ...base,
      contentLabel: p.label,
      kind: p.kind,
      ...(p.day ? { day: p.day } : {}),
      ...(p.slot ? { slot: p.slot } : {}),
      itemCount: p.items.length,
      items: teaser ? p.items.slice(0, 3) : p.items,
      totalKcal: publicationCalories(p.items),
      totalMacros: publicationMacros(p.items),
      ...(p.kind === 'day' && p.targets ? { targets: p.targets } : {}),
    };
  }
  /** Whether a stored post is what this create request asked for (an idempotent retry). */
  private sameRequest(
    row: FoodPostRecord,
    dto: CreatePostDto,
  ): boolean {
    return (
      !row.deleted &&
      row.previewHash === dto.previewHash &&
      row.title === dto.title.trim() &&
      row.caption === dto.caption.trim() &&
      row.audience === dto.audience &&
      (row.media ?? []).map((m) => m.id).join() === (dto.mediaIds ?? []).join()
    );
  }
  async create(userId: string, dto: CreatePostDto): Promise<FoodPost> {
    await this.requireEnabled(userId);
    const mediaIds = dto.mediaIds ?? [];
    if (
      !postHasContent({
        title: dto.title,
        caption: dto.caption,
        mediaCount: mediaIds.length,
        hasFood: !!dto.source,
      })
    )
      throw new BadRequestException('Write something, or add a photo or food.');
    if (!dto.source && dto.previewHash)
      throw new BadRequestException('A preview needs the food it previews.');
    const existing = await this.posts
      .findOne({ userId, requestId: dto.requestId })
      .lean();
    if (existing) {
      if (!this.sameRequest(existing, dto))
        throw new ConflictException('This publish request was already used.');
      return this.dto(
        existing,
        (await this.social.postAuthor(userId))!,
        userId,
        false,
      );
    }
    let preview: PostPreview | undefined;
    if (dto.source) {
      preview = await this.preview(userId, { source: dto.source });
      if (preview.previewHash !== dto.previewHash)
        throw new ConflictException(
          'Your selection changed. Preview it again before posting.',
        );
    }
    const media = await this.media.reserve(userId, dto.requestId, mediaIds);
    await this.social.own(userId);
    try {
      await this.posts.updateOne(
        { userId, requestId: dto.requestId },
        {
          $setOnInsert: {
            userId,
            requestId: dto.requestId,
            ...(preview
              ? { previewHash: preview.previewHash, publication: preview.publication }
              : {}),
            ...(media.length ? { media } : {}),
            title: dto.title.trim(),
            caption: dto.caption.trim(),
            audience: dto.audience,
            version: 1,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const row = (await this.posts
      .findOne({ userId, requestId: dto.requestId })
      .lean())!;
    if (!this.sameRequest(row, dto))
      throw new ConflictException('This publish request was already used.');
    if (media.length)
      await this.media.claim(userId, dto.requestId, String(row._id));
    return this.dto(
      row,
      (await this.social.postAuthor(userId))!,
      userId,
      false,
    );
  }
  private async readable(
    viewerId: string,
    row: FoodPostRecord,
  ): Promise<PostAuthor | null> {
    const own = row.userId === viewerId;
    const [connection, enabled, reported, author] = await Promise.all([
      own ? null : this.graph.between(viewerId, row.userId),
      this.enabled(row.userId),
      own
        ? null
        : this.reports.exists({
            userId: viewerId,
            postId: String(
              (row as FoodPostRecord & { _id: Types.ObjectId })._id,
            ),
          }),
      this.social.postAuthor(row.userId),
    ]);
    return author &&
      !reported &&
      canReadFoodPost({
        own,
        audience: row.audience,
        friends: connection?.state === 'accepted',
        blocked: !!connection?.blockedBy.length,
        enabled,
      })
      ? author
      : null;
  }
  private async read(viewerId: string, id: string) {
    await this.requireEnabled(viewerId);
    this.id(id);
    const row = await this.posts
      .findOne({ _id: id, deleted: { $ne: true }, ...ORIGINAL })
      .lean();
    const author = row ? await this.readable(viewerId, row) : null;
    if (!row || !author) throw new NotFoundException('Post not found.');
    return { row, author };
  }
  async detail(userId: string, id: string) {
    const { row, author } = await this.read(userId, id);
    return this.dto(row, author, userId, false);
  }
  /**
   * The link preview for anyone, signed in or not (spec 017). The same live checks a stranger
   * would get from `readable()`: public audience, not deleted, not a repost, author access on.
   * Any failure is the same 404, so a preview never tells a private post from a missing one.
   */
  async publicPreview(id: string): Promise<PublicPostPreview> {
    const missing = () => new NotFoundException('Post not found.');
    if (!isValidObjectId(id)) throw missing();
    const row = await this.posts
      .findOne({ _id: id, audience: 'public', deleted: { $ne: true }, ...ORIGINAL })
      .lean();
    if (!row || !(await this.enabled(row.userId))) throw missing();
    const author = await this.social.postAuthor(row.userId);
    if (!author) throw missing();
    const p = row.publication;
    const macros = p ? publicationMacros(p.items) : undefined;
    const [first] = await this.media.sign(row.media?.slice(0, 1));
    const photoUrl = first ? (first.kind === 'video' ? first.posterUrl : first.url) : undefined;
    return {
      id: String(row._id),
      title: row.title || p?.label || '',
      caption: row.caption.slice(0, 200),
      authorName: author.displayName,
      ...(p ? { label: p.label } : {}),
      ...(macros ? { macros } : {}),
      ...(photoUrl ? { photoUrl } : {}),
    };
  }
  /** The owner's live posts, newest first, as id → title. Used for their Activity. */
  async ownTitles(userId: string, limit = 500): Promise<Map<string, string>> {
    const rows = await this.posts
      .find({ userId, deleted: { $ne: true }, ...ORIGINAL })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('title')
      .lean();
    return new Map(rows.map((row) => [String(row._id), row.title]));
  }
  /** Each feed has its own key, so one feed's cursor is never accepted by another. */
  private cursorKey(feed: Feed) {
    return createHash('sha256')
      .update(this.config.jwtSecret)
      .update(feed === 'wall' ? 'food-post-feed-cursor' : 'for-you-feed-cursor')
      .digest();
  }
  private cursor(value?: string, feed: Feed = 'wall') {
    if (!value) return undefined;
    try {
      const bytes = Buffer.from(value, 'base64url');
      const cipher = createDecipheriv(
        'aes-256-gcm',
        this.cursorKey(feed),
        bytes.subarray(0, 12),
      );
      cipher.setAuthTag(bytes.subarray(12, 28));
      const parsed = JSON.parse(
        Buffer.concat([
          cipher.update(bytes.subarray(28)),
          cipher.final(),
        ]).toString(),
      ) as { date: string; id: string };
      if (
        !isValidObjectId(parsed.id) ||
        typeof parsed.date !== 'string' ||
        !Number.isFinite(Date.parse(parsed.date))
      )
        throw new Error();
      return { date: new Date(parsed.date), id: new Types.ObjectId(parsed.id) };
    } catch {
      throw new BadRequestException('Invalid feed cursor.');
    }
  }
  private encode(
    row: { createdAt: Date; _id: Types.ObjectId },
    feed: Feed = 'wall',
  ) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.cursorKey(feed), iv);
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify({
          date: row.createdAt.toISOString(),
          id: String(row._id),
        }),
      ),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      'base64url',
    );
  }
  async list(userId: string, query: PostListDto): Promise<PostPage> {
    await this.requireEnabled(userId);
    const authors = query.authorId
      ? [query.authorId]
      : [userId, ...(await this.graph.wallAuthorIds(userId))];
    let cursor = this.cursor(query.cursor);
    let scanned = 0;
    const visible: FoodPost[] = [];
    // A post and a repost of it can both be in range; a page shows it once.
    const shown = new Set<string>();
    let last: (FoodPostRecord & { _id: Types.ObjectId }) | undefined;
    let visibleCursor: (FoodPostRecord & { _id: Types.ObjectId }) | undefined;
    while (scanned < 100) {
      const rows = await this.posts
        .find({
          deleted: { $ne: true },
          userId: { $in: authors },
          ...(cursor
            ? {
                $or: [
                  { createdAt: { $lt: cursor.date } },
                  { createdAt: cursor.date, _id: { $lt: cursor.id } },
                ],
              }
            : {}),
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(25)
        .lean();
      for (const row of rows) {
        scanned++;
        last = row;
        if (
          query.authorId === userId &&
          query.preview !== 'normal' &&
          !(
            row.audience === 'public' ||
            (row.audience === 'friends' && query.preview === 'friend')
          )
        )
          continue;
        const card = await this.card(userId, row, shown);
        if (!card) continue;
        if (visible.length === 10)
          return { posts: visible, nextCursor: this.encode(visibleCursor!) };
        visible.push(card);
        shown.add(card.id);
        visibleCursor = row;
      }
      if (rows.length < 25) return { posts: visible };
      cursor = this.cursor(this.encode(last!));
    }
    return {
      posts: visible,
      ...(last ? { nextCursor: this.encode(last) } : {}),
    };
  }
  /**
   * For You (spec 018): live, original, public posts from across Life Portal, newest first.
   * Only authors who opted in to being found (`discoverable`) appear, never the viewer, anyone
   * blocked either way or anyone the viewer muted. Every row still passes `readable()`, so
   * audience, blocks, author access, reports and deletion are checked now, not when posted.
   * Reposts are left out: the original is the candidate. A page holds at most
   * FOR_YOU_AUTHOR_CAP posts per author; extras are skipped (they stay on the profile).
   */
  async forYou(userId: string, query: ForYouDto): Promise<PostPage> {
    await this.requireEnabled(userId);
    await this.access.require(userId, 'forYou');
    const [graphHidden, feedback] = await Promise.all([
      this.graph.hiddenAuthorIds(userId),
      this.feedback.find({ userId }).select('kind targetId').lean(),
    ]);
    const notInterested = new Set(
      feedback.filter((f) => f.kind === 'post').map((f) => f.targetId),
    );
    const excluded = [
      userId,
      ...graphHidden,
      ...feedback.filter((f) => f.kind === 'author').map((f) => f.targetId),
    ];
    let cursor = this.cursor(query.cursor, 'forYou');
    let scanned = 0;
    const visible: FoodPost[] = [];
    const perAuthor = new Map<string, number>();
    let last: PostRow | undefined;
    let visibleCursor: PostRow | undefined;
    while (scanned < SCAN_LIMIT) {
      const rows: PostRow[] = await this.posts
        .find({
          audience: 'public',
          deleted: { $ne: true },
          ...ORIGINAL,
          userId: { $nin: excluded },
          ...(cursor
            ? {
                $or: [
                  { createdAt: { $lt: cursor.date } },
                  { createdAt: cursor.date, _id: { $lt: cursor.id } },
                ],
              }
            : {}),
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(SCAN_BATCH)
        .lean();
      const discoverable = await this.social.discoverableIds([
        ...new Set(rows.map((row) => row.userId)),
      ]);
      for (const row of rows) {
        scanned++;
        last = row;
        if (!discoverable.has(row.userId)) continue;
        if (notInterested.has(String(row._id))) continue;
        const count = perAuthor.get(row.userId) ?? 0;
        if (count >= FOR_YOU_AUTHOR_CAP) continue;
        const author = await this.readable(userId, row);
        if (!author) continue;
        if (visible.length === PAGE_SIZE && visibleCursor)
          return {
            posts: visible,
            nextCursor: this.encode(visibleCursor, 'forYou'),
          };
        visible.push(await this.dto(row, author, userId, true));
        perAuthor.set(row.userId, count + 1);
        visibleCursor = row;
      }
      if (rows.length < SCAN_BATCH || !last) return { posts: visible };
      cursor = { date: last.createdAt, id: last._id };
    }
    return {
      posts: visible,
      ...(last ? { nextCursor: this.encode(last, 'forYou') } : {}),
    };
  }
  /**
   * One feed card. A repost must pass the audience check for its reposter *and* the original for
   * its author, both now: the original's audience, blocks and deletion always win.
   */
  private async card(
    viewerId: string,
    row: PostRow,
    shown: Set<string>,
  ): Promise<FoodPost | null> {
    if (!row.repostOf) {
      if (shown.has(String(row._id))) return null;
      const author = await this.readable(viewerId, row);
      return author ? this.dto(row, author, viewerId, true) : null;
    }
    if (shown.has(row.repostOf)) return null;
    const by = await this.readable(viewerId, row);
    if (!by) return null;
    const original = isValidObjectId(row.repostOf)
      ? await this.posts
          .findOne({ _id: row.repostOf, deleted: { $ne: true }, ...ORIGINAL })
          .lean()
      : null;
    const author = original ? await this.readable(viewerId, original) : null;
    if (!original || !author) return null;
    return {
      ...(await this.dto(original, author, viewerId, true)),
      repost: {
        id: String(row._id),
        by,
        isMine: row.userId === viewerId,
        createdAt: row.createdAt.toISOString(),
      },
    };
  }
  /**
   * Reposts a post the member can read. Returns the original, and whether this call created the
   * repost (a repeat is a no-op, so only the first one notifies).
   */
  async repost(userId: string, id: string): Promise<{ post: FoodPost; created: boolean }> {
    const { row, author } = await this.read(userId, id);
    if (!canRepost({ own: row.userId === userId, audience: row.audience }))
      throw new BadRequestException(
        row.userId === userId
          ? 'You can’t repost your own post.'
          : 'Private posts can’t be reposted.',
      );
    await this.social.own(userId);
    let created = false;
    try {
      const result = await this.posts.updateOne(
        { userId, requestId: repostRequest(id) },
        {
          $setOnInsert: {
            userId,
            requestId: repostRequest(id),
            repostOf: id,
            title: '',
            caption: '',
            audience: row.audience,
            version: 1,
          },
        },
        { upsert: true },
      );
      created = !!result.upsertedCount;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    return { post: await this.dto(row, author, userId, false), created };
  }
  /** Takes a repost back. A repost holds no content, likes or comments, so it is deleted. */
  async unrepost(userId: string, id: string) {
    await this.requireEnabled(userId);
    this.id(id);
    await this.posts.deleteOne({ userId, requestId: repostRequest(id) });
  }
  async repostState(userId: string, id: string) {
    const [repostCount, reposted] = await Promise.all([
      this.posts.countDocuments({ repostOf: id }),
      this.posts.exists({ userId, requestId: repostRequest(id) }),
    ]);
    return { repostCount, reposted: !!reposted };
  }
  /** Others' reposts of these posts, newest first, for their author's Activity. */
  async repostRows(
    postIds: string[],
    ownerId: string,
    since: Date,
    before: Date | undefined,
    limit: number,
  ) {
    return this.posts
      .find({
        repostOf: { $in: postIds },
        userId: { $ne: ownerId },
        createdAt: { $gte: since, ...(before ? { $lt: before } : {}) },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('userId repostOf createdAt')
      .lean();
  }
  async updateAudience(
    userId: string,
    id: string,
    audience: FoodPost['audience'],
  ) {
    await this.requireEnabled(userId);
    this.id(id);
    const result = await this.posts.updateOne(
      { _id: id, userId, deleted: { $ne: true }, ...ORIGINAL },
      { $set: { audience } },
    );
    if (!result.matchedCount) throw new NotFoundException('Post not found.');
    return { audience };
  }
  async update(userId: string, id: string, dto: UpdatePostDto) {
    await this.requireEnabled(userId);
    this.id(id);
    if (!dto.title.trim() && !dto.caption.trim()) {
      const row = await this.posts
        .findOne({ _id: id, userId, deleted: { $ne: true }, ...ORIGINAL })
        .select('publication media')
        .lean();
      if (row && !row.publication && !row.media?.length)
        throw new BadRequestException('A post without food or photos needs some text.');
    }
    const changed = await this.posts.updateOne(
      { _id: id, userId, deleted: { $ne: true }, ...ORIGINAL },
      {
        $set: {
          title: dto.title.trim(),
          caption: dto.caption.trim(),
          audience: dto.audience,
        },
      },
    );
    if (!changed.matchedCount) throw new NotFoundException('Post not found.');
    return this.detail(userId, id);
  }
  async remove(userId: string, id: string) {
    await this.requireEnabled(userId);
    this.id(id);
    if (
      !(
        await this.posts.updateOne(
          { _id: id, userId, ...ORIGINAL },
          {
            $set: { deleted: true, title: 'Removed post', caption: '' },
            $unset: { publication: '', media: '' },
          },
        )
      ).matchedCount
    )
      throw new NotFoundException('Post not found.');
    void this.media.removeForPost(id);
    return { success: true };
  }
  async importPreview(userId: string, id: string) {
    const { row } = await this.read(userId, id);
    if (row.userId === userId)
      throw new BadRequestException('These foods are already yours.');
    if (!row.publication)
      throw new BadRequestException('This post has no foods to save.');
    return this.nutrition.importPreview(userId, id, row.publication);
  }
  async import(userId: string, id: string, dto: ImportPostDto) {
    const { row, author } = await this.read(userId, id);
    if (row.userId === userId)
      throw new BadRequestException('These foods are already yours.');
    if (!row.publication)
      throw new BadRequestException('This post has no foods to save.');
    return this.nutrition.import(
      userId,
      id,
      author.displayName,
      row.publication,
      dto.itemKeys,
      dto.duplicatePolicy,
      dto.saveAsMeal,
      dto.mealName?.trim() || row.title || row.publication.label,
    );
  }
  /**
   * "Not interested" (`post`) or "Hide this author from For You" (`author`), and their undo.
   * Only for another member's post the viewer can read now; it never changes who can read what,
   * only what For You offers. Repeats are no-ops; undo deletes the row.
   */
  async feedFeedback(
    userId: string,
    id: string,
    kind: FeedFeedbackKind,
    on: boolean,
  ): Promise<{ success: true }> {
    await this.access.require(userId, 'forYou');
    const { row } = await this.read(userId, id);
    if (row.userId === userId)
      throw new BadRequestException('This is your own post.');
    const targetId = kind === 'post' ? id : row.userId;
    if (!on) {
      await this.feedback.deleteOne({ userId, kind, targetId });
      return { success: true };
    }
    try {
      await this.feedback.updateOne(
        { userId, kind, targetId },
        { $setOnInsert: { userId, kind, targetId } },
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    return { success: true };
  }
  async report(userId: string, id: string, dto: ReportPostDto) {
    await this.requireEnabled(userId);
    this.id(id);
    if (await this.reports.exists({ userId, postId: id }))
      return { success: true };
    let authorId: string;
    try {
      authorId = (await this.read(userId, id)).row.userId;
    } catch (error) {
      // Another identical report may have hidden the post between exists() and read().
      if (
        error instanceof NotFoundException &&
        (await this.reports.exists({ userId, postId: id }))
      )
        return { success: true };
      throw error;
    }
    if (authorId === userId)
      throw new BadRequestException('You can edit or delete your own post.');
    try {
      await this.reports.updateOne(
        { userId, postId: id },
        { $setOnInsert: { userId, postId: id, reason: dto.reason } },
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    return { success: true };
  }
  async reportQueue(userId: string): Promise<PostReport[]> {
    this.access.requireDeveloper(userId);
    const rows = await this.reports
      .find({ resolvedAt: { $exists: false } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return rows.map((r) => ({
      id: String(r._id),
      postId: r.postId,
      reporterId: r.userId,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
  }
  async moderate(userId: string, reportId: string) {
    this.access.requireDeveloper(userId);
    this.id(reportId);
    const report = await this.reports.findById(reportId).lean();
    if (!report) throw new NotFoundException('Report not found.');
    await this.posts.updateOne(
      { _id: report.postId },
      {
        $set: { deleted: true, title: 'Removed post', caption: '' },
        $unset: { publication: '', media: '' },
      },
    );
    void this.media.removeForPost(report.postId);
    await this.reports.updateMany(
      { postId: report.postId },
      { $set: { resolvedAt: new Date() } },
    );
    return { success: true };
  }
}
