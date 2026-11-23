import { ConflictException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { SocialGraphService } from '../social-graph/social-graph.module';

/**
 * A follow (spec 040): a one-way link, no approval. A person or a page follows a page; a page
 * may also follow a person. A person never follows a person: people are friends, mutually. The only stored fact is the link; counts are
 * counted on read.
 */
@Schema({ collection: 'follows', timestamps: { createdAt: true, updatedAt: false }, versionKey: false })
export class Follow {
  @Prop({ required: true }) followerId!: string;
  /** The account followed: a page, or (when the follower is a page) a person. The name is older than that. */
  @Prop({ required: true, index: true }) pageId!: string;
  createdAt!: Date;
}
export const FollowSchema = SchemaFactory.createForClass(Follow);
FollowSchema.index({ followerId: 1, pageId: 1 }, { unique: true });

const notFound = () => new NotFoundException('Page not found.');

/** Suggestions stop once someone follows this many pages: by then they have found their own. */
export const SUGGEST_UNTIL_FOLLOWING = 5;
/** How many pages a list of suggestions holds. */
export const SUGGESTED_PAGES = 8;

@Injectable()
export class FollowsService {
  constructor(
    @InjectModel(Follow.name) private readonly follows: Model<Follow>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly graph: SocialGraphService,
  ) {}

  /**
   * Follows an account. Anyone may follow a page. Only a page may follow a person (the owner's
   * decision, 2026-11-23): it then sees that person's public posts in its Following feed. A
   * person does not follow a person; people are friends. One answer for a missing, suspended or
   * switched-off account, a person following a person, and a block in either direction.
   */
  async follow(followerId: string, targetId: string): Promise<{ following: true }> {
    if (followerId === targetId) throw new ConflictException('An account cannot follow itself.');
    if (!isValidObjectId(targetId) || !isValidObjectId(followerId)) throw notFound();
    const [target, follower] = await Promise.all([
      this.users.findOne({ _id: targetId, suspendedAt: { $exists: false }, disabledAt: { $exists: false } }).select('kind').lean(),
      this.users.findById(followerId).select('kind').lean(),
    ]);
    if (!target || !follower) throw notFound();
    if (target.kind !== 'page' && follower.kind !== 'page') throw notFound();
    if (await this.graph.isBlocked(followerId, targetId)) throw notFound();
    try {
      await this.follows.updateOne({ followerId, pageId: targetId }, { $setOnInsert: { followerId, pageId: targetId } }, { upsert: true });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    return { following: true };
  }

  async unfollow(followerId: string, pageId: string): Promise<{ following: false }> {
    await this.follows.deleteOne({ followerId, pageId });
    return { following: false };
  }

  async isFollowing(followerId: string, pageId: string): Promise<boolean> {
    return !!(await this.follows.exists({ followerId, pageId }));
  }

  /** Which of these accounts the follower follows. */
  async followingAmong(followerId: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.follows.find({ followerId, pageId: { $in: ids } }).select('pageId').lean();
    return new Set(rows.map((row) => row.pageId));
  }

  /** The pages someone follows: whose public posts their Following feed shows. */
  async followedPageIds(followerId: string): Promise<string[]> {
    const rows = await this.follows.find({ followerId }).select('pageId').lean();
    return rows.map((row) => row.pageId);
  }

  followerCount(pageId: string): Promise<number> {
    return this.follows.countDocuments({ pageId });
  }

  /** A block between two accounts ends any follow between them, in either direction. */
  async endBetween(a: string, b: string): Promise<void> {
    await this.follows.deleteMany({ $or: [{ followerId: a, pageId: b }, { followerId: b, pageId: a }] });
  }

  /**
   * Pages to offer someone who follows fewer than `SUGGEST_UNTIL_FOLLOWING`: the app's own first, then the most followed, never
   * one they already follow, their own, a suspended one or one blocked either way.
   */
  async suggested(viewerId: string, limit = SUGGESTED_PAGES): Promise<string[]> {
    const [already, pages] = await Promise.all([
      this.followedPageIds(viewerId),
      this.users
        .find({ kind: 'page', suspendedAt: { $exists: false }, disabledAt: { $exists: false }, managers: { $ne: viewerId } })
        .select('official')
        .limit(500)
        .lean<{ _id: Types.ObjectId; official?: boolean }[]>(),
    ]);
    if (already.length >= SUGGEST_UNTIL_FOLLOWING) return [];
    const skip = new Set([...already, viewerId]);
    const candidates = pages.filter((page) => !skip.has(String(page._id)));
    if (!candidates.length) return [];
    const ids = candidates.map((page) => String(page._id));
    const counts = await this.follows.aggregate<{ _id: string; n: number }>([{ $match: { pageId: { $in: ids } } }, { $group: { _id: '$pageId', n: { $sum: 1 } } }]);
    const followers = new Map(counts.map((row) => [row._id, row.n]));
    const ranked = candidates
      .map((page) => ({ id: String(page._id), official: page.official === true, followers: followers.get(String(page._id)) ?? 0 }))
      .sort((a, b) => Number(b.official) - Number(a.official) || b.followers - a.followers || a.id.localeCompare(b.id));
    const open: string[] = [];
    for (const page of ranked) {
      if (open.length === limit) break;
      if (!(await this.graph.isBlocked(viewerId, page.id))) open.push(page.id);
    }
    return open;
  }
}

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Follow.name, schema: FollowSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
