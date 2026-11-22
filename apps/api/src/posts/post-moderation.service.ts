import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types, isValidObjectId } from 'mongoose';
import type { ModerationItem, ModerationQueue, ReportReason } from '@life-portal/shared-types';
import { imageHoldCategories, reportsHoldPost } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { reviewNeededEmail } from '../auth/emails';
import { CONFIG, type AppConfig } from '../config/configuration';
import { MAILER, type Mailer } from '../mail/mailer';
import { MediaService } from '../media/media.service';
import { IMAGE_CHECKER, type ImageChecker } from '../moderation/image-checker';
import { SocialService } from '../social/social.module';
import { TrainingPublicationService } from '../training/training-publication.service';
import { FoodPostRecord, PostReportRecord } from './posts.schemas';

type PostRow = FoodPostRecord & { _id: Types.ObjectId };

/** A post still waiting for its check after this long shows in the queue, so it is never stuck unseen. */
const STUCK_MS = 30 * 60 * 1000;
/** How soon the retry job picks up a check that did not finish. */
const RETRY_AFTER_MS = 60 * 1000;
const QUEUE_LIMIT = 100;

/** Whether anyone but the author can reach a post with this audience. */
export const visibleToOthers = (post: { audience: string; linkKey?: string }): boolean =>
  post.audience !== 'private' || !!post.linkKey;

/**
 * Keeping what strangers should not see off the app (spec 039): a post's photos are checked
 * before anyone but its author sees it, reported posts are hidden once enough people report
 * them, and the developer reviews what is held. Holding is a field on the post that
 * `canReadFoodPost()` honours, so every read path follows it.
 */
@Injectable()
export class PostModerationService {
  private readonly log = new Logger(PostModerationService.name);

  constructor(
    @InjectModel(FoodPostRecord.name) private readonly posts: Model<FoodPostRecord>,
    @InjectModel(PostReportRecord.name) private readonly reports: Model<PostReportRecord>,
    private readonly access: AccessService,
    private readonly social: SocialService,
    private readonly media: MediaService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(IMAGE_CHECKER) private readonly checker: ImageChecker | null,
    @Inject(MAILER) private readonly mailer: Mailer | null,
    @Optional() private readonly trainingPublications?: TrainingPublicationService,
  ) {}

  /** Whether a new post with these properties starts out held for its check. */
  holdsNew(post: { audience: string; linkKey?: string; mediaCount: number }): boolean {
    return !!this.checker && post.mediaCount > 0 && visibleToOthers(post);
  }

  /**
   * Called after a post was created or its audience changed. A post with photos that others can
   * now reach and that was never checked is held, then checked. Never throws, never awaited for
   * the check itself.
   */
  async onVisible(postId: string): Promise<void> {
    if (!this.checker) return;
    try {
      const held = await this.posts.updateOne(
        {
          _id: postId,
          deleted: { $ne: true },
          'media.0': { $exists: true },
          mediaCheck: { $exists: false },
          heldAt: { $exists: false },
          $or: [{ audience: { $ne: 'private' } }, { linkKey: { $exists: true } }],
        },
        { $set: { heldAt: new Date(), heldReason: 'checking' } },
      );
      const waiting = held.matchedCount || (await this.posts.exists({ _id: postId, heldReason: 'checking' }));
      if (waiting) void this.check(postId);
    } catch (error) {
      this.log.warn(`Could not hold a post for its check: ${(error as Error).name}`);
    }
  }

  /** Runs the automatic check for one post that is waiting for it. Never throws. */
  async check(postId: string): Promise<void> {
    if (!this.checker) return;
    try {
      const row = await this.posts.findOne({ _id: postId, heldReason: 'checking', deleted: { $ne: true } }).lean();
      if (!row) return;
      const signed = await this.media.sign(row.media);
      // A video is judged by its still: the service reads images only.
      const urls = signed.flatMap((item) => (item.kind === 'video' ? (item.posterUrl ? [item.posterUrl] : []) : [item.url]));
      const verdict = urls.length ? await this.checker.check(urls) : { flagged: [] };
      const hold = imageHoldCategories(verdict.flagged);
      if (hold.length) {
        const flagged = await this.posts.updateOne(
          { _id: postId, heldReason: 'checking' },
          { $set: { heldReason: 'check', mediaCheck: 'flagged', checkCategories: hold } },
        );
        if (flagged.matchedCount) this.tellReviewer();
      } else {
        await this.posts.updateOne(
          { _id: postId, heldReason: 'checking' },
          { $set: { mediaCheck: 'ok' }, $unset: { heldAt: '', heldReason: '' } },
        );
      }
    } catch (error) {
      // Stays held and is tried again by `retryChecks()`. No id and no link in the log.
      this.log.warn(`An image check did not finish: ${(error as Error).message}`);
    }
  }

  /** Checks that did not finish (the service was down, the process restarted) are run again. */
  @Cron('*/10 * * * *', { name: 'retry-image-checks' })
  async retryChecks(now = new Date()): Promise<void> {
    if (this.config.disableSchedules || !this.checker) return;
    const rows = await this.posts
      .find({ heldReason: 'checking', heldAt: { $lt: new Date(now.getTime() - RETRY_AFTER_MS) }, deleted: { $ne: true } })
      .sort({ heldAt: 1 })
      .limit(20)
      .select('_id')
      .lean();
    for (const row of rows) await this.check(String(row._id));
  }

  /** Called after a report was stored: hides the post once the reports on it are enough. */
  async onReport(postId: string): Promise<void> {
    try {
      const [post, open] = await Promise.all([
        this.posts.findById(postId).select('heldAt reviewedAt').lean(),
        this.reports.find({ postId, resolvedAt: { $exists: false } }).select('reason').lean(),
      ]);
      if (!post) return;
      const reasons = open.map((row) => row.reason);
      if (!post.heldAt && reportsHoldPost(reasons, !!post.reviewedAt)) {
        await this.posts.updateOne({ _id: postId, heldAt: { $exists: false } }, { $set: { heldAt: new Date(), heldReason: 'reports' } });
      }
      // One notice for the first report on a post, not one per report.
      if (open.length === 1 || reasons.includes('child_safety')) this.tellReviewer();
    } catch (error) {
      this.log.warn(`Could not weigh a report: ${(error as Error).name}`);
    }
  }

  /** What is waiting for the reviewer: held posts first, then reported ones. */
  async queue(userId: string, now = new Date()): Promise<ModerationQueue> {
    this.access.requireDeveloper(userId);
    const open = await this.reports.find({ resolvedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(1000).select('postId reason').lean();
    const byPost = new Map<string, ReportReason[]>();
    for (const row of open) byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), row.reason]);
    const reportedIds = [...byPost.keys()].filter((id) => isValidObjectId(id));
    const rows = (await this.posts
      .find({
        deleted: { $ne: true },
        $or: [
          { heldReason: { $in: ['check', 'reports'] } },
          { heldReason: 'checking', heldAt: { $lt: new Date(now.getTime() - STUCK_MS) } },
          ...(reportedIds.length ? [{ _id: { $in: reportedIds } }] : []),
        ],
      })
      .sort({ heldAt: -1, createdAt: -1 })
      .limit(QUEUE_LIMIT)
      .lean()) as PostRow[];
    // Reports on posts that are gone need no decision.
    const live = new Set(rows.map((row) => String(row._id)));
    const gone = reportedIds.filter((id) => !live.has(id));
    if (gone.length && rows.length < QUEUE_LIMIT) {
      await this.reports.updateMany({ postId: { $in: gone }, resolvedAt: { $exists: false } }, { $set: { resolvedAt: now, resolution: 'removed' } });
    }
    const suspended = await this.access.suspendedAmong([...new Set(rows.map((row) => row.userId))]);
    const items: ModerationItem[] = [];
    for (const row of rows) {
      const id = String(row._id);
      const author = await this.social.postAuthor(row.userId);
      const counts = new Map<ReportReason, number>();
      for (const reason of byPost.get(id) ?? []) counts.set(reason, (counts.get(reason) ?? 0) + 1);
      items.push({
        postId: id,
        author: {
          id: row.userId,
          displayName: author?.displayName ?? 'Former member',
          ...(author?.username ? { username: author.username } : {}),
          suspended: suspended.has(row.userId),
        },
        title: row.title,
        caption: row.caption,
        audience: row.audience,
        linkOnly: !!row.linkKey,
        createdAt: row.createdAt.toISOString(),
        media: await this.media.sign(row.media),
        ...(row.publication ? { attachment: row.publication.label } : row.training ? { attachment: 'Training' } : {}),
        ...(row.heldReason ? { held: row.heldReason } : {}),
        ...(row.heldAt ? { heldAt: row.heldAt.toISOString() } : {}),
        ...(row.checkCategories?.length ? { checkCategories: row.checkCategories } : {}),
        reports: [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
        reportCount: byPost.get(id)?.length ?? 0,
      });
    }
    items.sort((a, b) => Number(!!b.held) - Number(!!a.held) || b.reportCount - a.reportCount);
    return { items, imageCheck: !!this.checker };
  }

  /** The reviewer decides the post is fine: it is shown again and its reports are closed. */
  async keep(userId: string, postId: string): Promise<{ success: true }> {
    this.access.requireDeveloper(userId);
    if (!isValidObjectId(postId)) throw new NotFoundException('Post not found.');
    const kept = await this.posts.updateOne(
      { _id: postId, deleted: { $ne: true } },
      { $set: { reviewedAt: new Date() }, $unset: { heldAt: '', heldReason: '' } },
    );
    if (!kept.matchedCount) throw new NotFoundException('Post not found.');
    await this.reports.updateMany({ postId, resolvedAt: { $exists: false } }, { $set: { resolvedAt: new Date(), resolution: 'kept' } });
    return { success: true };
  }

  /** The reviewer removes the post: its content and files are erased, as when its author deletes it. */
  async remove(userId: string, postId: string): Promise<{ success: true }> {
    this.access.requireDeveloper(userId);
    if (!isValidObjectId(postId)) throw new NotFoundException('Post not found.');
    const before = await this.posts.findOne({ _id: postId }).lean();
    if (!before) throw new NotFoundException('Post not found.');
    await this.posts.updateOne(
      { _id: postId },
      {
        $set: { deleted: true, title: 'Removed post', caption: '' },
        $unset: { publication: '', media: '', training: '', trainingHash: '', allowCopy: '', heldAt: '', heldReason: '', checkCategories: '', linkKey: '', linkViewers: '' },
      },
    );
    void this.media.removeForPost(postId);
    if (before.training) void this.trainingPublications?.removePhotos(before.training);
    await this.reports.updateMany({ postId, resolvedAt: { $exists: false } }, { $set: { resolvedAt: new Date(), resolution: 'removed' } });
    return { success: true };
  }

  /** An email to the developer that something waits in the queue. It names no post and no person. */
  private tellReviewer(): void {
    if (!this.mailer || !this.config.webBaseUrl) return;
    const link = `${this.config.webBaseUrl}/settings/reports`;
    void this.access
      .developerEmail()
      .then((to) => (to ? this.mailer?.send(reviewNeededEmail(to, link)) : undefined))
      .catch((error: unknown) => this.log.warn(`Could not send the review notice: ${(error as Error).name}`));
  }
}
