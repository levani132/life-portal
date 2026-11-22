import {
  Body,
  CallHandler,
  ConflictException,
  Controller,
  Inject,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
  Delete,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  NestInterceptor,
  NotFoundException,
  OnModuleInit,
  Param,
  Put,
  Query,
  UseInterceptors,
  UnauthorizedException,
} from '@nestjs/common';
import {
  InjectModel,
  MongooseModule,
  Prop,
  Schema,
  SchemaFactory,
} from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { imageHoldCategories } from '@life-portal/shared-domain';
import { IMAGE_CHECKER, type ImageChecker } from '../moderation/image-checker';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import {
  CONNECTION_ACTIONS,
  type ConnectionAction,
  type ConnectionList,
  type PeoplePage,
  type SocialPerson,
  type SocialAvatarUpdate,
  type SocialProfile as ProfileDto,
  type SocialProfileUpdate,
} from '@life-portal/shared-types';
import { toDay, relationshipFor } from '@life-portal/shared-domain';
import { AccessService, RequireModule } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { baseSchemaOptions } from '../common/mongoose';
import { Today } from '../common/today';
import { SocialGraphService } from '../social-graph/social-graph.module';
import { NotificationsService } from '../notifications/notifications.service';
import { NutritionModule } from '../nutrition/nutrition.module';
import { SettingsModule } from '../settings/settings.module';
import { CashflowModule } from '../cashflow/cashflow.module';
import { StocksModule } from '../stocks/stocks.module';
import { LoansModule } from '../loans/loans.module';
import { ItemsModule } from '../items/items.module';
import { PersonalModule } from '../personal/personal.module';
import { BoardsModule } from '../boards/boards.module';
import { FxModule } from '../fx/fx.module';
import { MediaService } from '../media/media.service';
import { SharedWidgetsService } from './shared-widgets.service';
import { ForPages, NotForPages } from '../auth/acting';

@Schema({ ...baseSchemaOptions, collection: 'social_profiles' })
class SocialProfile {
  @Prop({ required: true, unique: true }) userId!: string;
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  username!: string;
  @Prop({ required: true, trim: true }) displayName!: string;
  @Prop({ default: '' }) bio!: string;
  @Prop({ default: false, index: true }) discoverable!: boolean;
  /** The profile photo's storage key. Never leaves the API: responses carry a signed `avatarUrl`. */
  @Prop() avatarKey?: string;
  /** Spec 040: copied from the account, so naming an author needs no second lookup. */
  @Prop({ type: String, enum: ['page'] }) kind?: 'page';
}
const ProfileSchema = SchemaFactory.createForClass(SocialProfile);
export class ProfileUpdateDto implements SocialProfileUpdate {
  @Matches(/^[a-z0-9][a-z0-9_-]{2,29}$/, {
    message: 'Use 3–30 lowercase letters, numbers, underscores or hyphens.',
  })
  username!: string;
  @IsString() @MinLength(1) @MaxLength(80) displayName!: string;
  @IsString() @MaxLength(300) bio!: string;
  @IsBoolean() discoverable!: boolean;
}
class AvatarDto implements SocialAvatarUpdate {
  @IsString() @MaxLength(64) mediaId!: string;
}
class ConnectionDto {
  @IsIn(CONNECTION_ACTIONS) action!: ConnectionAction;
}
class DatedQuery {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  today?: string;
}
class SearchDto extends DatedQuery {
  @IsString() @MaxLength(80) q = '';
  @Type(() => Number) @IsInt() @Min(0) @Max(10000) skip = 0;
}
class ListDto extends DatedQuery {
  @IsIn(['friends', 'incoming', 'outgoing', 'blocked']) kind: ConnectionList =
    'friends';
  @Type(() => Number) @IsInt() @Min(0) @Max(10000) skip = 0;
}
class PreviewDto extends DatedQuery {
  @IsIn(['normal', 'friend', 'stranger']) preview:
    | 'normal'
    | 'friend'
    | 'stranger' = 'normal';
}
class DiaryQueryDto extends PreviewDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDateString({ strict: true })
  day?: string;
}
@Injectable()
export class SocialNoStore implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'private, no-store');
    return next.handle();
  }
}
@Injectable()
export class SocialService implements OnModuleInit {
  constructor(
    @InjectModel(SocialProfile.name)
    private readonly profiles: Model<SocialProfile>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly graph: SocialGraphService,
    private readonly access: AccessService,
    private readonly shared: SharedWidgetsService,
    private readonly notifications: NotificationsService,
    private readonly media: MediaService,
    @Optional() @Inject(IMAGE_CHECKER) private readonly imageChecker: ImageChecker | null = null,
  ) {}
  /** Friend notifications and their Activity rows (docs/modules/notifications.md). */
  onModuleInit() {
    this.notifications.register({
      type: 'friendRequest',
      requires: ['social'],
      windowMs: 0,
      collapseKey: (event) => event.actorId,
      url: () => '/friends',
    });
    this.notifications.register({
      type: 'friendAccepted',
      requires: ['social'],
      windowMs: 0,
      collapseKey: (event) => event.actorId,
      url: (event) => `/people/${event.actorId}`,
    });
    this.notifications.registerActivitySource({
      rows: async (userId, since, before, limit) => {
        const events = await this.graph.activity(userId, since, before, limit);
        const names = await this.displayNames(events.map((e) => e.otherId));
        return events.map((e) => ({
          type: e.kind === 'incoming' ? ('friendRequest' as const) : ('friendAccepted' as const),
          actorId: e.otherId,
          actorName: names.get(e.otherId) ?? 'Former member',
          targetId: e.otherId,
          url: e.kind === 'incoming' ? '/friends' : `/people/${e.otherId}`,
          createdAt: e.at,
        }));
      },
    });
  }
  /** Public identity for several members at once (Messages). Missing members are left out. */
  async authors(
    userIds: string[],
  ): Promise<
    Map<string, { userId: string; displayName: string; username: string; avatarUrl?: string }>
  > {
    if (!userIds.length) return new Map();
    const rows = await this.profiles
      .find({ userId: { $in: [...new Set(userIds)] } })
      .select('userId displayName username avatarKey')
      .lean();
    return new Map(
      await Promise.all(
        rows.map(async (row) => [row.userId, await this.identity(row)] as const),
      ),
    );
  }
  /**
   * Who someone is, for anything that names them: post authors, comments, chat headers. A profile
   * photo is shown wherever the name is, so it is signed here, after the caller's own check.
   */
  private async identity(profile: SocialProfile) {
    const avatarUrl = await this.avatarUrl(profile);
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      username: profile.username,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(profile.kind === 'page' ? { isPage: true as const } : {}),
    };
  }
  /**
   * Spec 040: a page's profile, made with the page. The username comes from the same pool as
   * people's. A page exists to be found, so it is discoverable from the start.
   */
  async createPageProfile(pageId: string, input: { displayName: string; username: string; bio: string }): Promise<void> {
    try {
      await this.profiles.create({ userId: pageId, kind: 'page', discoverable: true, ...input });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw usernameTaken();
      throw error;
    }
  }
  /** Whether a username is free, for a page being created. */
  async usernameFree(username: string): Promise<boolean> {
    return !(await this.profiles.exists({ username: username.toLowerCase() }));
  }
  /** Profiles of these accounts, as their managers see them. */
  async summaries(userIds: string[]): Promise<Map<string, { displayName: string; username: string; bio: string; avatarUrl?: string }>> {
    if (!userIds.length) return new Map();
    const rows = await this.profiles.find({ userId: { $in: userIds } }).lean();
    const out = new Map<string, { displayName: string; username: string; bio: string; avatarUrl?: string }>();
    for (const row of rows) {
      const avatarUrl = await this.avatarUrl(row);
      out.set(row.userId, { displayName: row.displayName, username: row.username, bio: row.bio, ...(avatarUrl ? { avatarUrl } : {}) });
    }
    return out;
  }
  private async avatarUrl(profile: SocialProfile) {
    return profile.avatarKey ? this.media.signKey(profile.avatarKey) : undefined;
  }
  /** Display names for Activity and notification text. */
  async displayNames(userIds: string[]): Promise<Map<string, string>> {
    if (!userIds.length) return new Map();
    const rows = await this.profiles
      .find({ userId: { $in: [...new Set(userIds)] } })
      .select('userId displayName')
      .lean();
    return new Map(rows.map((row) => [row.userId, row.displayName]));
  }
  private async enabled(userId: string) {
    try {
      return (await this.access.forUser(userId)).access.social;
    } catch (error) {
      if (error instanceof UnauthorizedException) return false;
      throw error;
    }
  }
  private oid(id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException('Profile not found.');
    return id;
  }
  async own(userId: string) {
    const existing = await this.profiles.findOne({ userId }).lean();
    if (existing) return existing;
    const user = await this.users.findById(userId).select('name').lean();
    if (!user) throw new NotFoundException('Account not found.');
    try {
      await this.profiles.updateOne(
        { userId },
        {
          $setOnInsert: {
            userId,
            username: `user-${userId}`,
            displayName: user.name,
            bio: '',
            discoverable: false,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    return (await this.profiles.findOne({ userId }).lean())!;
  }
  /** Which of these people opted in to being found by strangers (search and For You). */
  async discoverableIds(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows = await this.profiles
      .find({ userId: { $in: userIds }, discoverable: true })
      .select('userId')
      .lean();
    return new Set(rows.map((row) => row.userId));
  }
  async postAuthor(userId: string) {
    const profile = await this.profiles.findOne({ userId }).lean();
    return profile ? this.identity(profile) : null;
  }
  private async person(
    profile: SocialProfile,
    relationship: SocialPerson['relationship'],
    muted = false,
  ): Promise<SocialPerson> {
    return {
      ...(await this.identity(profile)),
      bio: profile.bio,
      relationship,
      muted,
    };
  }
  /** Replaces the profile photo with a copy of an upload, then deletes the old file. */
  async setAvatar(userId: string, dto: AvatarDto) {
    const previous = (await this.own(userId)).avatarKey;
    const { key } = await this.media.copyForAvatar(userId, dto.mediaId);
    // Spec 039: a profile photo is shown to everyone, so it is checked before it is used.
    const refusal = await this.avatarRefusal(key);
    if (refusal) {
      await this.media.deleteKey(key);
      throw refusal;
    }
    await this.profiles.updateOne({ userId }, { $set: { avatarKey: key } });
    if (previous) await this.media.deleteKey(previous);
    return { avatarUrl: await this.media.signKey(key) };
  }
  /** Why this stored image may not be a profile photo, or nothing when it may (or no check is set up). */
  private async avatarRefusal(key: string): Promise<Error | undefined> {
    if (!this.imageChecker) return undefined;
    const url = await this.media.signKey(key);
    if (!url) return undefined;
    try {
      const { flagged } = await this.imageChecker.check([url]);
      return imageHoldCategories(flagged).length
        ? new UnprocessableEntityException({ code: 'PHOTO_REFUSED', message: 'That photo can’t be used as a profile photo. Choose another one.' })
        : undefined;
    } catch {
      return new ServiceUnavailableException({ code: 'PHOTO_CHECK_DOWN', message: 'Photos can’t be checked right now. Try again in a minute.' });
    }
  }
  async removeAvatar(userId: string) {
    const previous = (await this.own(userId)).avatarKey;
    if (!previous) return { success: true };
    await this.profiles.updateOne({ userId }, { $unset: { avatarKey: 1 } });
    await this.media.deleteKey(previous);
    return { success: true };
  }
  async update(userId: string, dto: ProfileUpdateDto) {
    if (
      /^user-[0-9a-f]{24}$/.test(dto.username) &&
      dto.username !== `user-${userId}`
    )
      throw new ConflictException('Choose another username.');
    if (!dto.displayName.trim())
      throw new ConflictException('Choose a display name.');
    await this.own(userId);
    try {
      await this.profiles.updateOne(
        { userId },
        {
          $set: {
            ...dto,
            displayName: dto.displayName.trim(),
            bio: dto.bio.trim(),
          },
        },
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new ConflictException('That username is already taken.');
      throw error;
    }
    return { success: true };
  }
  async profile(
    viewerId: string,
    targetId: string,
    today: string,
    preview: PreviewDto['preview'] = 'normal',
  ): Promise<ProfileDto> {
    this.oid(targetId);
    const self = viewerId === targetId;
    const row = self ? null : await this.graph.between(viewerId, targetId);
    if (row?.blockedBy.length)
      throw new NotFoundException('Profile not found.');
    const profile = self
      ? await this.own(viewerId)
      : await this.profiles.findOne({ userId: targetId }).lean();
    if (!profile || !(await this.enabled(targetId)))
      throw new NotFoundException('Profile not found.');
    const viewer = await this.access.forUser(viewerId);
    const friends = self ? preview !== 'stranger' : row?.state === 'accepted';
    return {
      ...(await this.person(
        profile,
        self ? 'self' : relationshipFor(row, viewerId, targetId),
        row?.mutedBy.includes(viewerId),
      )),
      ...(self
        ? {
            discoverable: profile.discoverable,
            friendCount: await this.graph.friendCount(viewerId),
          }
        : {}),
      widgets: await this.shared.forViewer(
        targetId,
        viewer.access,
        friends,
        today,
      ),
    };
  }
  async foodDiary(
    viewerId: string,
    targetId: string,
    today: string,
    query: DiaryQueryDto,
  ) {
    this.oid(targetId);
    const day = toDay(query.day ?? today);
    if (day > today) throw new NotFoundException('Diary not available.');
    const self = viewerId === targetId;
    const connection = self
      ? null
      : await this.graph.between(viewerId, targetId);
    if (connection?.blockedBy.length || !(await this.enabled(targetId)))
      throw new NotFoundException('Diary not available.');
    const viewer = await this.access.forUser(viewerId);
    const friends = self
      ? query.preview !== 'stranger'
      : connection?.state === 'accepted';
    const diary = await this.shared.diaryForViewer(
      targetId,
      viewer.access,
      friends,
      day,
      today,
    );
    if (!diary) throw new NotFoundException('Diary not available.');
    return diary;
  }
  async search(userId: string, query: SearchDto): Promise<PeoplePage> {
    const q = query.q.trim();
    if (q.length < 2)
      return { people: [], hasMore: false, nextSkip: query.skip };
    const blocked = await this.graph.blockedUserIds(userId);
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rows = await this.profiles
      .find({
        discoverable: true,
        userId: { $nin: [userId, ...blocked] },
        $or: [
          { displayName: new RegExp(escaped, 'i') },
          { username: new RegExp(escaped, 'i') },
        ],
      })
      .sort({ displayName: 1, _id: 1 })
      .skip(query.skip)
      .limit(21)
      .lean();
    const people = await Promise.all(
      rows.slice(0, 20).map(async (p) => {
        if (!(await this.enabled(p.userId))) return null;
        const connection = await this.graph.between(userId, p.userId);
        if (connection?.blockedBy.length) return null;
        return await this.person(p, relationshipFor(connection, userId, p.userId));
      }),
    );
    return {
      people: people.filter((p): p is SocialPerson => !!p),
      hasMore: rows.length > 20,
      nextSkip: query.skip + 20,
    };
  }
  async connections(
    userId: string,
    query: ListDto,
    today: string,
  ): Promise<PeoplePage> {
    const rows = await this.graph.list(userId, query.kind, query.skip);
    const viewer = await this.access.forUser(userId);
    const people = await Promise.all(
      rows.slice(0, 20).map(async (row) => {
        const targetId = row.lowId === userId ? row.highId : row.lowId;
        const profile = await this.profiles
          .findOne({ userId: targetId })
          .lean();
        if (
          !profile ||
          (query.kind !== 'blocked' && !(await this.enabled(targetId)))
        )
          return null;
        return {
          ...(await this.person(
            profile,
            relationshipFor(row, userId, targetId),
            row.mutedBy.includes(userId),
          )),
          ...(query.kind === 'friends'
            ? {
                widgets: await this.shared.forViewer(
                  targetId,
                  viewer.access,
                  true,
                  today,
                  2,
                ),
              }
            : {}),
        };
      }),
    );
    return {
      people: people.filter((p) => p !== null),
      hasMore: rows.length > 20,
      nextSkip: query.skip + 20,
    };
  }
  async act(userId: string, targetId: string, dto: ConnectionDto) {
    this.oid(targetId);
    if (userId === targetId)
      throw new ConflictException('Choose another person.');
    // Unblock always remains possible from the private blocked list, even if the other
    // account has disabled social access. No action trusts a client-supplied actor ID.
    if (dto.action !== 'unblock') {
      const target = await this.profiles.findOne({ userId: targetId }).lean();
      if (!target || !(await this.enabled(targetId)))
        throw new NotFoundException('Profile not found.');
      if (
        dto.action !== 'block' &&
        (await this.graph.isBlocked(userId, targetId))
      )
        throw new NotFoundException('Profile not found.');
    }
    const actor = await this.own(userId);
    const changed = await this.graph.act(userId, targetId, dto.action);
    // Not awaited: a failing push service must never fail the request itself.
    if (changed && (dto.action === 'request' || dto.action === 'accept'))
      void this.notifications.notify({
        type: dto.action === 'request' ? 'friendRequest' : 'friendAccepted',
        recipientId: targetId,
        actorId: userId,
        actorName: actor.displayName,
        targetId: userId,
      });
    return { success: true };
  }
}
@RequireModule('social')
@UseInterceptors(SocialNoStore)
@ForPages()
@Controller('social')
export class SocialController {
  constructor(private readonly social: SocialService) {}
  @Get('me') me(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Query() query: PreviewDto,
  ) {
    return this.social.profile(userId, userId, today, query.preview);
  }
  @Put('me') update(
    @CurrentUser('userId') userId: string,
    @Body() dto: ProfileUpdateDto,
  ) {
    return this.social.update(userId, dto);
  }
  @Put('me/avatar') setAvatar(
    @CurrentUser('userId') userId: string,
    @Body() dto: AvatarDto,
  ) {
    return this.social.setAvatar(userId, dto);
  }
  @Delete('me/avatar') removeAvatar(@CurrentUser('userId') userId: string) {
    return this.social.removeAvatar(userId);
  }
  @Get('search') search(
    @CurrentUser('userId') userId: string,
    @Query() query: SearchDto,
  ) {
    return this.social.search(userId, query);
  }
  @Get('requests/count') async requestCount(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
  ) {
    const page = await this.social.connections(
      userId,
      { kind: 'incoming', skip: 0 },
      today,
    );
    return { count: page.people.length, more: page.hasMore };
  }
  @NotForPages()
  @Get('connections') connections(
    @CurrentUser('userId') userId: string,
    @Query() query: ListDto,
    @Today() today: string,
  ) {
    return this.social.connections(userId, query, today);
  }
  @Get('profiles/:id') profile(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Today() today: string,
  ) {
    return this.social.profile(userId, id, today);
  }
  @Get('profiles/:id/food') foodDiary(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Today() today: string,
    @Query() query: DiaryQueryDto,
  ) {
    return this.social.foodDiary(userId, id, today, query);
  }
  @NotForPages()
  @Put('connections/:id') act(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: ConnectionDto,
  ) {
    return this.social.act(userId, id, dto);
  }
}
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SocialProfile.name, schema: ProfileSchema },
      { name: User.name, schema: UserSchema },
    ]),
    SettingsModule,
    NutritionModule,
    CashflowModule,
    StocksModule,
    LoansModule,
    ItemsModule,
    PersonalModule,
    BoardsModule,
    FxModule,
  ],
  controllers: [SocialController],
  providers: [SocialService, SharedWidgetsService, SocialNoStore],
  exports: [SocialService, SocialNoStore],
})
export class SocialModule {}

/** The one answer for a username someone else has, whether a person or a page. */
export function usernameTaken(): ConflictException {
  return new ConflictException({ code: 'USERNAME_TAKEN', message: 'That username is already taken.' });
}
