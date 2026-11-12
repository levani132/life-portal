import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import {
  MAX_POST_MEDIA,
  MAX_VIDEO_SECONDS,
  MEDIA_LIMITS,
  type MediaConfig,
  type MediaUploadTicket,
  type PostMedia,
} from '@life-portal/shared-types';
import { mediaLimitError, mediaListError } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { CONFIG, type AppConfig } from '../config/configuration';
import { StorageService } from '../storage/storage.module';
import type { AttachedMedia } from '../posts/posts.schemas';
import type { MediaUploadDto } from './media.dto';
import { MediaUploadRecord } from './media.schemas';

/** Upload links per person per hour. Ten full posts' worth, with room for retries. */
const UPLOADS_PER_HOUR = 60;
/** A pending upload no post claimed within a day is deleted, file and all. */
const PENDING_HOURS = 24;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/**
 * Photos and videos, for posts and for foods' pictures. The browser uploads straight to storage
 * with a signed link; this service decides who may upload what, checks the file really arrived
 * before a post or food can use it, signs short-lived read links (only after the caller's own
 * authorization) and deletes files with whatever owned them.
 */
@Injectable()
export class MediaService {
  private readonly log = new Logger(MediaService.name);
  constructor(
    @InjectModel(MediaUploadRecord.name)
    private readonly media: Model<MediaUploadRecord>,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async mediaConfig(userId: string): Promise<MediaConfig> {
    const { access } = await this.access.forUser(userId);
    return {
      available: !!access.postMedia && this.storage.configured,
      maxItems: MAX_POST_MEDIA,
      maxVideoSeconds: MAX_VIDEO_SECONDS,
    };
  }

  private async requireAvailable(userId: string) {
    await this.access.require(userId, 'postMedia');
    if (!this.storage.configured)
      throw new ServiceUnavailableException('Photo uploads are not set up on this server.');
  }

  async ticket(userId: string, dto: MediaUploadDto): Promise<MediaUploadTicket> {
    await this.requireAvailable(userId);
    const problem = mediaLimitError(dto);
    if (problem) throw new BadRequestException(problem);
    const recent = await this.media.countDocuments({
      userId,
      createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
    });
    if (recent >= UPLOADS_PER_HOUR)
      throw new HttpException(
        'Too many uploads in the last hour. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const id = new Types.ObjectId();
    const key = `media/${userId}/${String(id)}.${EXTENSIONS[dto.contentType]}`;
    const posterKey = dto.poster ? `media/${userId}/${String(id)}-poster.jpg` : undefined;
    await this.media.create({
      _id: id,
      userId,
      kind: dto.kind,
      key,
      contentType: dto.contentType,
      bytes: dto.bytes,
      width: dto.width,
      height: dto.height,
      ...(dto.durationMs !== undefined ? { durationMs: dto.durationMs } : {}),
      ...(posterKey ? { posterKey, posterBytes: dto.poster!.bytes } : {}),
    });
    return {
      id: String(id),
      upload: await this.storage.presignPut(key, dto.contentType, dto.bytes),
      ...(posterKey
        ? { poster: await this.storage.presignPut(posterKey, 'image/jpeg', dto.poster!.bytes) }
        : {}),
    };
  }

  /**
   * Reserves the uploads for one publish request and checks each file is in storage with the
   * declared size and type. Reserving by `requestId` first means two posts can never claim the
   * same upload, and a retried publish finds its own reservation again.
   */
  async reserve(userId: string, requestId: string, ids: string[]): Promise<AttachedMedia[]> {
    if (!ids.length) return [];
    await this.requireAvailable(userId);
    const problem = mediaListError(ids);
    if (problem) throw new BadRequestException(problem);
    await this.media.updateMany(
      {
        _id: { $in: ids },
        userId,
        postId: { $exists: false },
        requestId: { $exists: false },
      },
      { $set: { requestId } },
    );
    const rows = await this.media.find({ _id: { $in: ids }, userId, requestId }).lean();
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    const attached: AttachedMedia[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) throw new BadRequestException('One of the photos can no longer be used.');
      const [file, poster] = await Promise.all([
        this.storage.head(row.key),
        row.posterKey ? this.storage.head(row.posterKey) : null,
      ]);
      const fits = (
        object: { bytes: number; contentType: string } | null,
        bytes: number,
        type: string,
      ) => !!object && object.bytes === bytes && object.contentType === type;
      if (
        !fits(file, row.bytes, row.contentType) ||
        (row.posterKey && !fits(poster, row.posterBytes ?? -1, 'image/jpeg')) ||
        row.bytes > MEDIA_LIMITS[row.kind].maxBytes
      )
        throw new BadRequestException('Upload not finished. Wait for it, then share again.');
      attached.push({
        id,
        kind: row.kind,
        key: row.key,
        ...(row.posterKey ? { posterKey: row.posterKey } : {}),
        contentType: row.contentType,
        width: row.width,
        height: row.height,
        ...(row.durationMs !== undefined ? { durationMs: row.durationMs } : {}),
      });
    }
    return attached;
  }

  /** Marks reserved uploads as belonging to the created post, so cleanup leaves them alone. */
  async claim(userId: string, requestId: string, postId: string) {
    await this.media.updateMany({ userId, requestId }, { $set: { postId } });
  }

  /** Read links for a post the viewer has already been allowed to see. */
  async sign(media: AttachedMedia[] | undefined, now = new Date()): Promise<PostMedia[]> {
    if (!media?.length || !this.storage.configured) return [];
    return Promise.all(
      media.map(async (item) => ({
        id: item.id,
        kind: item.kind,
        width: item.width,
        height: item.height,
        ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
        url: await this.storage.presignGet(item.key, now),
        ...(item.posterKey
          ? { posterUrl: await this.storage.presignGet(item.posterKey, now) }
          : {}),
      })),
    );
  }

  /** Deletes a removed post's files and ledger rows. Never throws. */
  async removeForPost(postId: string) {
    try {
      const rows = await this.media.find({ postId }).lean();
      await this.purge(rows);
    } catch (error) {
      this.log.warn(`Could not delete media for a removed post: ${(error as Error).message}`);
    }
  }

  private async purge(rows: MediaUploadRecord[]) {
    if (!this.storage.configured) return;
    for (const row of rows) {
      const removed = await Promise.all([
        this.storage.delete(row.key),
        row.posterKey ? this.storage.delete(row.posterKey) : true,
      ]);
      // A row is only dropped once its files are gone, so a failed delete is retried next hour.
      if (removed.every(Boolean))
        await this.media.deleteOne({ _id: (row as MediaUploadRecord & { _id: unknown })._id });
    }
  }

  /**
   * A food's picture: a copy of an upload (a video's still, for a video), so the food and any post
   * using the same capture never share a file. The upload itself stays pending, free for a post.
   */
  async copyForFood(
    userId: string,
    mediaId: string,
    foodId: string,
  ): Promise<{ key: string; width: number; height: number }> {
    return this.copyImage(userId, mediaId, `foods/${userId}/${foodId}-`);
  }

  /**
   * A profile photo: a copy of an image upload, the same way as a food's. The browser has already
   * cropped it square and small (`prepareAvatar`), so it is cheap beside every post in a feed.
   */
  async copyForAvatar(userId: string, mediaId: string): Promise<{ key: string }> {
    const { key } = await this.copyImage(userId, mediaId, `avatars/${userId}/`, false);
    return { key };
  }

  private async copyImage(
    userId: string,
    mediaId: string,
    prefix: string,
    allowVideo = true,
  ): Promise<{ key: string; width: number; height: number }> {
    await this.requireAvailable(userId);
    if (!Types.ObjectId.isValid(mediaId)) throw new BadRequestException('That photo can no longer be used.');
    const row = await this.media.findOne({ _id: mediaId, userId }).lean();
    if (!row || (!allowVideo && row.kind !== 'image'))
      throw new BadRequestException('That photo can no longer be used.');
    const source = row.kind === 'video' ? row.posterKey : row.key;
    const object = source ? await this.storage.head(source) : null;
    if (!source || !object || object.contentType !== 'image/jpeg')
      throw new BadRequestException('Upload not finished. Wait for it, then save again.');
    const key = `${prefix}${String(new Types.ObjectId())}.jpg`;
    await this.storage.copy(source, key);
    const scale =
      row.kind === 'video' ? 1080 / Math.max(row.width, row.height, 1080) : 1;
    return {
      key,
      width: Math.max(1, Math.round(row.width * scale)),
      height: Math.max(1, Math.round(row.height * scale)),
    };
  }

  /** Signs one stored image the caller is already allowed to see. */
  async signKey(key: string): Promise<string | undefined> {
    return this.storage.configured ? this.storage.presignGet(key) : undefined;
  }

  /** Deletes a file that belonged to something removed. Never throws. */
  async deleteKey(key: string | undefined) {
    if (key && this.storage.configured) await this.storage.delete(key);
  }

  /** Uploads no post claimed within a day: abandoned drafts. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'clean-pending-media' })
  async cleanPending() {
    if (this.config.disableSchedules || !this.storage.configured) return;
    const rows = await this.media
      .find({
        postId: { $exists: false },
        createdAt: { $lt: new Date(Date.now() - PENDING_HOURS * 60 * 60 * 1000) },
      })
      .limit(200)
      .lean();
    await this.purge(rows);
    if (rows.length) this.log.log(`Deleted ${rows.length} unused uploads.`);
  }
}
