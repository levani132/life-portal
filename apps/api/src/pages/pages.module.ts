import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  Global,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  ACT_AS_HEADER,
  PAGE_BIO_MAX,
  PAGE_NAME_MAX,
  type CreatePageRequest,
  type Identity,
  type MyPages,
  type PageSummary,
  type SuggestedPage,
  type UpdatePageRequest,
} from '@life-portal/shared-types';
import { mayCreatePage, pagesRemaining } from '@life-portal/shared-domain';
import { AccessService, RequireModule } from '../access/access.module';
import { FollowsService } from '../follows/follows.module';
import { AccountModule } from '../account/account.module';
import { AccountService } from '../account/account.service';
import { ACT_MODE, AsPerson, ForPages, type ActMode } from '../auth/acting';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { CONFIG, type AppConfig } from '../config/configuration';
import { SocialModule, SocialService, usernameTaken } from '../social/social.module';

type PageRow = User & { _id: Types.ObjectId };

const notManager = () => new ForbiddenException({ code: 'NOT_A_MANAGER', message: 'You do not manage that page.' });

/** A page's reserved address: required and unique on the account, and unable to receive mail. */
export const pageEmail = (id: string) => `${id}@pages.lifeportal.invalid`;

export class CreatePageDto implements CreatePageRequest {
  @IsString() @MinLength(1) @MaxLength(PAGE_NAME_MAX) name!: string;
  @Matches(/^[a-z0-9][a-z0-9_-]{2,29}$/, { message: 'Use 3–30 lowercase letters, numbers, underscores or hyphens.' })
  username!: string;
  @IsOptional() @IsString() @MaxLength(PAGE_BIO_MAX) bio?: string;
}

export class UpdatePageDto implements UpdatePageRequest {
  @IsString() @MinLength(1) @MaxLength(PAGE_NAME_MAX) name!: string;
  @Matches(/^[a-z0-9][a-z0-9_-]{2,29}$/, { message: 'Use 3–30 lowercase letters, numbers, underscores or hyphens.' })
  username!: string;
  @IsString() @MaxLength(PAGE_BIO_MAX) bio!: string;
  @IsOptional() @IsBoolean() aiManaged?: boolean;
}

/**
 * Pages (spec 040): accounts that are not a person. This module owns creating and managing
 * them and the check behind "acting as" one. A page is a `users` row of kind `page`, so every
 * other module finds its author, its features and its suspension the way it does for a person.
 */
@Injectable()
export class PagesService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly access: AccessService,
    private readonly social: SocialService,
    private readonly accounts: AccountService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async requireOn(personId: string): Promise<void> {
    if (!(await this.access.forUser(personId)).access.pages) {
      throw new ForbiddenException({ code: 'PAGES_OFF', message: 'Pages are not available for your account yet.' });
    }
  }

  private async summaries(rows: PageRow[]): Promise<PageSummary[]> {
    const profiles = await this.social.summaries(rows.map((row) => String(row._id)));
    return rows.map((row) => {
      const id = String(row._id);
      const profile = profiles.get(id);
      return {
        id,
        name: profile?.displayName ?? row.name,
        username: profile?.username ?? '',
        bio: profile?.bio ?? '',
        ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        aiManaged: row.aiManaged === true,
        official: row.official === true,
        suspended: !!row.suspendedAt,
      };
    });
  }

  /** The pages this person manages, and how many more they may create. */
  async mine(personId: string): Promise<MyPages> {
    const { access } = await this.access.forUser(personId);
    if (!access.pages) return { pages: [], remaining: 0 };
    const [rows, person, created] = await Promise.all([
      this.users.find({ kind: 'page', managers: personId }).sort({ createdAt: 1 }).lean<PageRow[]>(),
      this.users.findById(personId).select('pageLimit').lean(),
      this.users.countDocuments({ kind: 'page', createdBy: personId }),
    ]);
    return {
      pages: await this.summaries(rows),
      remaining: pagesRemaining({ pageLimit: person?.pageLimit, developer: personId === this.config.developerUserId, created }),
    };
  }

  async create(personId: string, dto: CreatePageDto): Promise<PageSummary> {
    await this.requireOn(personId);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Give the page a name.');
    const [person, created] = await Promise.all([
      this.users.findById(personId).select('pageLimit kind').lean(),
      this.users.countDocuments({ kind: 'page', createdBy: personId }),
    ]);
    if (!person || person.kind === 'page') throw notManager();
    if (!mayCreatePage({ pageLimit: person.pageLimit, developer: personId === this.config.developerUserId, created })) {
      throw new ForbiddenException({ code: 'PAGE_LIMIT', message: 'You have reached the number of pages you can create. Write to support if you need more.' });
    }
    // Checked first for a clear answer; the profile's unique index is what actually decides.
    if (!(await this.social.usernameFree(dto.username))) throw usernameTaken();
    const id = new Types.ObjectId();
    await this.users.create({
      _id: id,
      kind: 'page',
      email: pageEmail(String(id)),
      name,
      roles: [],
      cohort: 'production',
      managers: [personId],
      createdBy: personId,
    });
    try {
      await this.social.createPageProfile(String(id), { displayName: name, username: dto.username, bio: (dto.bio ?? '').trim() });
    } catch (error) {
      // Lost the race for the username: no half-made page is left behind.
      await this.users.deleteOne({ _id: id });
      throw error;
    }
    const [summary] = await this.summaries([(await this.users.findById(id).lean<PageRow>()) as PageRow]);
    return summary;
  }

  /** The page, if this person manages it. One answer for "not yours" and "does not exist". */
  private async managed(personId: string, pageId: string): Promise<PageRow> {
    if (!isValidObjectId(pageId)) throw notManager();
    const row = await this.users.findOne({ _id: pageId, kind: 'page', managers: personId }).lean<PageRow>();
    if (!row) throw notManager();
    return row;
  }

  async update(personId: string, pageId: string, dto: UpdatePageDto): Promise<PageSummary> {
    await this.requireOn(personId);
    const row = await this.managed(personId, pageId);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Give the page a name.');
    await this.social.update(pageId, { username: dto.username, displayName: name, bio: dto.bio, discoverable: true } as never);
    await this.users.updateOne({ _id: row._id }, { $set: { name, ...(dto.aiManaged !== undefined ? { aiManaged: dto.aiManaged } : {}) } });
    const [summary] = await this.summaries([(await this.users.findById(row._id).lean<PageRow>()) as PageRow]);
    return summary;
  }

  /** The owner marks any page as the app's own. Nobody else can, their own pages included. */
  async setOfficial(personId: string, pageId: string, official: boolean): Promise<{ official: boolean }> {
    this.access.requireDeveloper(personId);
    if (!isValidObjectId(pageId)) throw notManager();
    const changed = await this.users.updateOne({ _id: pageId, kind: 'page' }, official ? { $set: { official: true } } : { $unset: { official: '' } });
    if (!changed.matchedCount) throw notManager();
    await this.social.setOfficial(pageId, official);
    return { official };
  }

  /** Deletes the page and everything it holds, the way an account is deleted. */
  async remove(personId: string, pageId: string): Promise<{ success: true }> {
    const row = await this.managed(personId, pageId);
    await this.accounts.erase(String(row._id));
    return { success: true };
  }

  /**
   * The check behind every request made as a page: the person manages it, the feature is on for
   * them, and the page is not suspended. Returns the page's id.
   */
  async actingAs(personId: string, pageId: string): Promise<string> {
    if (!isValidObjectId(pageId)) throw notManager();
    const [page, { access }] = await Promise.all([
      this.users.findOne({ _id: pageId, kind: 'page', managers: personId }).select('suspendedAt').lean(),
      this.access.forUser(personId),
    ]);
    if (!page || !access.pages) throw notManager();
    if (page.suspendedAt) throw new ForbiddenException({ code: 'PAGE_SUSPENDED', message: 'This page has been suspended.' });
    return String(page._id);
  }

  /** Who the request is made as, for the web app's shell. */
  async identity(user: AuthenticatedUser): Promise<Identity> {
    const personId = user.actorId ?? user.userId;
    if (personId === user.userId) return { kind: 'person', id: personId };
    const [page] = await this.summaries([(await this.users.findById(user.userId).lean<PageRow>()) as PageRow]);
    return { kind: 'page', id: user.userId, page, personId };
  }
}

/**
 * Runs after authentication, before the feature check. With no `x-lp-act-as` header it does
 * nothing. With one, the route's marker decides (see `auth/acting.ts`): a person route ignores
 * it, a route open to pages runs as the page once `actingAs()` agrees, and any other route is
 * refused. Token-authenticated and public routes have no session user and are left alone.
 */
@Injectable()
export class ActingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly pages: PagesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser; headers: Record<string, string | string[] | undefined> }>();
    const header = request.headers[ACT_AS_HEADER];
    const pageId = Array.isArray(header) ? header[0] : header;
    if (!pageId || !request.user?.actorId) return true;
    const mode = this.reflector.getAllAndOverride<ActMode | 'none' | undefined>(ACT_MODE, [context.getHandler(), context.getClass()]);
    if (mode === 'person') return true;
    if (mode !== 'page') {
      throw new ForbiddenException({ code: 'NOT_FOR_PAGES', message: 'A page cannot do that. Switch back to your own account.' });
    }
    request.user = { ...request.user, userId: await this.pages.actingAs(request.user.actorId, pageId) };
    return true;
  }
}

@AsPerson()
@Controller('pages')
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  mine(@CurrentUser('userId') personId: string): Promise<MyPages> {
    return this.pages.mine(personId);
  }

  @Post()
  create(@CurrentUser('userId') personId: string, @Body() dto: CreatePageDto): Promise<PageSummary> {
    return this.pages.create(personId, dto);
  }

  @Patch(':id')
  update(@CurrentUser('userId') personId: string, @Param('id') id: string, @Body() dto: UpdatePageDto): Promise<PageSummary> {
    return this.pages.update(personId, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentUser('userId') personId: string, @Param('id') id: string) {
    return this.pages.remove(personId, id);
  }
}

export class OfficialDto {
  @IsBoolean() official!: boolean;
}

@AsPerson()
@Controller('pages')
export class PageOfficialController {
  constructor(private readonly pages: PagesService) {}

  @Put(':id/official')
  official(@CurrentUser('userId') personId: string, @Param('id') id: string, @Body() dto: OfficialDto) {
    return this.pages.setOfficial(personId, id, dto.official);
  }
}

/**
 * Following (spec 040): a person or a page follows a page. One way, no approval, and a page's
 * public posts then show in the follower's Following feed.
 */
@RequireModule('social')
@ForPages()
@Controller('follows')
export class FollowsController {
  constructor(
    private readonly follows: FollowsService,
    private readonly social: SocialService,
  ) {}

  @Get('suggested')
  async suggested(@CurrentUser('userId') userId: string): Promise<SuggestedPage[]> {
    const ids = await this.follows.suggested(userId);
    const profiles = await this.social.pageCards(ids);
    const out: SuggestedPage[] = [];
    for (const id of ids) {
      const profile = profiles.get(id);
      if (profile) out.push({ ...profile, followerCount: await this.follows.followerCount(id) });
    }
    return out;
  }

  @Put(':pageId')
  follow(@CurrentUser('userId') userId: string, @Param('pageId') pageId: string) {
    return this.follows.follow(userId, pageId);
  }

  @Delete(':pageId')
  @HttpCode(200)
  unfollow(@CurrentUser('userId') userId: string, @Param('pageId') pageId: string) {
    return this.follows.unfollow(userId, pageId);
  }
}

@ForPages()
@Controller('identity')
export class IdentityController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  identity(@CurrentUser() user: AuthenticatedUser): Promise<Identity> {
    return this.pages.identity(user);
  }
}

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), SocialModule, AccountModule],
  controllers: [PagesController, PageOfficialController, IdentityController, FollowsController],
  providers: [PagesService, ActingGuard],
  exports: [PagesService, ActingGuard],
})
export class PagesModule {}
