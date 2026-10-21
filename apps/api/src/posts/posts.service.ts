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
  PostPage,
  PostPreview,
  PostReport,
} from '@life-portal/shared-types';
import {
  canReadFoodPost,
  canonicalPublication,
  publicationCalories,
} from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { NutritionPublicationService } from '../nutrition/nutrition-publication.service';
import { SocialService } from '../social/social.module';
import { SocialGraphService } from '../social-graph/social-graph.module';
import { FoodPostRecord, PostReportRecord } from './posts.schemas';
import type {
  CreatePostDto,
  ImportPostDto,
  PostListDto,
  PreviewPostDto,
  ReportPostDto,
  UpdatePostDto,
} from './posts.dto';

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
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
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
  private dto(
    row: FoodPostRecord & { _id: Types.ObjectId },
    author: PostAuthor,
    viewerId: string,
    teaser: boolean,
  ): FoodPost {
    const p = row.publication;
    return {
      id: String(row._id),
      author,
      title: row.title,
      caption: row.caption,
      audience: row.audience,
      kind: p.kind,
      ...(p.day ? { day: p.day } : {}),
      ...(p.slot ? { slot: p.slot } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: 1,
      itemCount: p.items.length,
      items: teaser ? p.items.slice(0, 3) : p.items,
      totalKcal: publicationCalories(p.items),
      isOwner: row.userId === viewerId,
    };
  }
  async create(userId: string, dto: CreatePostDto): Promise<FoodPost> {
    await this.requireEnabled(userId);
    const existing = await this.posts
      .findOne({ userId, requestId: dto.requestId })
      .lean();
    if (existing) {
      if (
        existing.deleted ||
        existing.previewHash !== dto.previewHash ||
        existing.title !== dto.title.trim() ||
        existing.caption !== dto.caption.trim() ||
        existing.audience !== dto.audience
      )
        throw new ConflictException('This publish request was already used.');
      return this.dto(
        existing,
        (await this.social.postAuthor(userId))!,
        userId,
        false,
      );
    }
    if (!dto.title.trim())
      throw new BadRequestException('Give the post a title.');
    const preview = await this.preview(userId, dto);
    if (preview.previewHash !== dto.previewHash)
      throw new ConflictException(
        'Your selection changed. Preview it again before posting.',
      );
    await this.social.own(userId);
    try {
      await this.posts.updateOne(
        { userId, requestId: dto.requestId },
        {
          $setOnInsert: {
            userId,
            requestId: dto.requestId,
            previewHash: dto.previewHash,
            publication: preview.publication,
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
    if (
      row.deleted ||
      row.previewHash !== dto.previewHash ||
      row.title !== dto.title.trim() ||
      row.caption !== dto.caption.trim() ||
      row.audience !== dto.audience
    )
      throw new ConflictException('This publish request was already used.');
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
      .findOne({ _id: id, deleted: { $ne: true } })
      .lean();
    const author = row ? await this.readable(viewerId, row) : null;
    if (!row || !author) throw new NotFoundException('Post not found.');
    return { row, author };
  }
  async detail(userId: string, id: string) {
    const { row, author } = await this.read(userId, id);
    return this.dto(row, author, userId, false);
  }
  private cursorKey() {
    return createHash('sha256')
      .update(this.config.jwtSecret)
      .update('food-post-feed-cursor')
      .digest();
  }
  private cursor(value?: string) {
    if (!value) return undefined;
    try {
      const bytes = Buffer.from(value, 'base64url');
      const cipher = createDecipheriv(
        'aes-256-gcm',
        this.cursorKey(),
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
  private encode(row: { createdAt: Date; _id: Types.ObjectId }) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.cursorKey(), iv);
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
        const author = await this.readable(userId, row);
        if (!author) continue;
        if (visible.length === 10)
          return { posts: visible, nextCursor: this.encode(visibleCursor!) };
        visible.push(this.dto(row, author, userId, true));
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
  async update(userId: string, id: string, dto: UpdatePostDto) {
    await this.requireEnabled(userId);
    this.id(id);
    if (!dto.title.trim())
      throw new BadRequestException('Give the post a title.');
    const changed = await this.posts.updateOne(
      { _id: id, userId, deleted: { $ne: true } },
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
          { _id: id, userId },
          {
            $set: { deleted: true, title: 'Removed post', caption: '' },
            $unset: { publication: '' },
          },
        )
      ).matchedCount
    )
      throw new NotFoundException('Post not found.');
    return { success: true };
  }
  async importPreview(userId: string, id: string) {
    const { row } = await this.read(userId, id);
    if (row.userId === userId)
      throw new BadRequestException('These foods are already yours.');
    return this.nutrition.importPreview(userId, id, row.publication);
  }
  async import(userId: string, id: string, dto: ImportPostDto) {
    const { row, author } = await this.read(userId, id);
    if (row.userId === userId)
      throw new BadRequestException('These foods are already yours.');
    return this.nutrition.import(
      userId,
      id,
      author.displayName,
      row.publication,
      dto.itemKeys,
      dto.duplicatePolicy,
      dto.saveAsMeal,
      dto.mealName?.trim() || row.title,
    );
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
        $unset: { publication: '' },
      },
    );
    await this.reports.updateMany(
      { postId: report.postId },
      { $set: { resolvedAt: new Date() } },
    );
    return { success: true };
  }
}
