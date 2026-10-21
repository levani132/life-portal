import {
  Body,
  CallHandler,
  ConflictException,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  NestInterceptor,
  NotFoundException,
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
import { NutritionModule } from '../nutrition/nutrition.module';
import { SettingsModule } from '../settings/settings.module';
import { CashflowModule } from '../cashflow/cashflow.module';
import { StocksModule } from '../stocks/stocks.module';
import { LoansModule } from '../loans/loans.module';
import { ItemsModule } from '../items/items.module';
import { PersonalModule } from '../personal/personal.module';
import { BoardsModule } from '../boards/boards.module';
import { FxModule } from '../fx/fx.module';
import { SharedWidgetsService } from './shared-widgets.service';

@Schema({ ...baseSchemaOptions, collection: 'social_profiles' })
class SocialProfile {
  @Prop({ required: true, unique: true }) userId!: string;
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  username!: string;
  @Prop({ required: true, trim: true }) displayName!: string;
  @Prop({ default: '' }) bio!: string;
  @Prop({ default: false, index: true }) discoverable!: boolean;
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
export class SocialService {
  constructor(
    @InjectModel(SocialProfile.name)
    private readonly profiles: Model<SocialProfile>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly graph: SocialGraphService,
    private readonly access: AccessService,
    private readonly shared: SharedWidgetsService,
  ) {}
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
  async postAuthor(userId: string) {
    const profile = await this.profiles.findOne({ userId }).lean();
    return profile
      ? {
          userId: profile.userId,
          displayName: profile.displayName,
          username: profile.username,
        }
      : null;
  }
  private person(
    profile: SocialProfile,
    relationship: SocialPerson['relationship'],
    muted = false,
  ): SocialPerson {
    return {
      userId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      relationship,
      muted,
    };
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
      ...this.person(
        profile,
        self ? 'self' : relationshipFor(row, viewerId, targetId),
        row?.mutedBy.includes(viewerId),
      ),
      ...(self ? { discoverable: profile.discoverable } : {}),
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
        return this.person(p, relationshipFor(connection, userId, p.userId));
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
          ...this.person(
            profile,
            relationshipFor(row, userId, targetId),
            row.mutedBy.includes(userId),
          ),
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
    await this.own(userId);
    await this.graph.act(userId, targetId, dto.action);
    return { success: true };
  }
}
@RequireModule('social')
@UseInterceptors(SocialNoStore)
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
