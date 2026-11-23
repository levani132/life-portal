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
  Header,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  ACT_AS_HEADER,
  PAGE_BIO_MAX,
  PAGE_LIMIT_MAX,
  PAGE_LIMIT_NONE,
  type AdminAccount,
  type AdminAccountsPage,
  type SetPageLimitRequest,
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
import { NotificationsService } from '../notifications/notifications.service';
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

export class AssistantDto {
  @IsBoolean() enabled!: boolean;
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
    private readonly follows: FollowsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** A page has no devices: its notifications go to its managers' (docs/modules/notifications.md). */
  onModuleInit() {
    this.notifications.registerPageResolver(async (userId) => {
      if (!isValidObjectId(userId)) return null;
      const page = await this.users.findOne({ _id: userId, kind: 'page' }).select('name managers').lean();
      return page ? { name: page.name, managers: page.managers ?? [] } : null;
    });
  }

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
    if (!access.pages) return { pages: [], remaining: 0, assistant: false };
    const [rows, person, created] = await Promise.all([
      this.users.find({ kind: 'page', managers: personId }).sort({ createdAt: 1 }).lean<PageRow[]>(),
      this.users.findById(personId).select('pageLimit assistantPages').lean(),
      this.users.countDocuments({ kind: 'page', createdBy: personId }),
    ]);
    return {
      pages: await this.summaries(rows),
      remaining: pagesRemaining({ pageLimit: person?.pageLimit, developer: personId === this.config.developerUserId, created }),
      assistant: person?.assistantPages === true,
    };
  }

  async create(personId: string, dto: CreatePageDto, options: { aiManaged?: boolean } = {}): Promise<PageSummary> {
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
      ...(options.aiManaged ? { aiManaged: true } : {}),
    });
    try {
      await this.social.createPageProfile(String(id), { displayName: name, username: dto.username, bio: (dto.bio ?? '').trim() });
      if (options.aiManaged) await this.social.setAiManaged(String(id), true);
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
    if (dto.aiManaged !== undefined) await this.social.setAiManaged(pageId, dto.aiManaged);
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

  /**
   * The owner's People screen: people or pages, by name or username, 30 at a time. Names and
   * marks only: no email and nothing an account keeps.
   */
  async adminList(developerId: string, query: AdminListDto): Promise<AdminAccountsPage> {
    this.access.requireDeveloper(developerId);
    const pages = query.kind === 'pages';
    const text = (query.q ?? '').trim().slice(0, 60);
    const filter: Record<string, unknown> = pages ? { kind: 'page' } : { kind: { $ne: 'page' } };
    if (text) {
      const byUsername = await this.social.idsByUsernamePrefix(text.toLowerCase().replace(/^@/, ''));
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter['$or'] = [{ name: { $regex: escaped, $options: 'i' } }, { _id: { $in: byUsername.filter((id) => isValidObjectId(id)) } }];
    }
    const rows = await this.users
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(query.skip ?? 0)
      .limit(ADMIN_PAGE_SIZE + 1)
      .select('name kind suspendedAt pageLimit official aiManaged managers assistantCaps')
      .lean<PageRow[]>();
    const shown = rows.slice(0, ADMIN_PAGE_SIZE);
    const ids = shown.map((row) => String(row._id));
    const managerIds = [...new Set(shown.flatMap((row) => row.managers ?? []))];
    const [profiles, managers, created] = await Promise.all([
      this.social.summaries(ids),
      managerIds.length ? this.users.find({ _id: { $in: managerIds } }).select('name').lean<{ _id: Types.ObjectId; name: string }[]>() : Promise.resolve([] as { _id: Types.ObjectId; name: string }[]),
      pages ? Promise.resolve([] as { _id: string; n: number }[]) : this.users.aggregate<{ _id: string; n: number }>([{ $match: { kind: 'page', createdBy: { $in: ids } } }, { $group: { _id: '$createdBy', n: { $sum: 1 } } }]),
    ]);
    const managerName = new Map(managers.map((row) => [String(row._id), row.name]));
    const createdBy = new Map(created.map((row) => [row._id, row.n]));
    const accounts: AdminAccount[] = [];
    for (const row of shown) {
      const id = String(row._id);
      const username = profiles.get(id)?.username;
      const base = { id, name: profiles.get(id)?.displayName ?? row.name, ...(username ? { username } : {}), suspended: !!row.suspendedAt };
      accounts.push(
        pages
          ? {
              ...base,
              kind: 'page',
              official: row.official === true,
              aiManaged: row.aiManaged === true,
              followerCount: await this.follows.followerCount(id),
              managers: (row.managers ?? []).map((managerId) => managerName.get(managerId) ?? 'Unknown'),
            }
          : {
              ...base,
              kind: 'person',
              ...(typeof row.pageLimit === 'number' ? { pageLimit: row.pageLimit } : {}),
              ...(row.assistantCaps ? { assistantCaps: row.assistantCaps } : {}),
              pagesCreated: createdBy.get(id) ?? 0,
              ...(id === this.config.developerUserId ? { developer: true as const } : {}),
            },
      );
    }
    return { accounts, hasMore: rows.length > ADMIN_PAGE_SIZE };
  }

  /** The owner sets how many pages one person may create: a number, `-1` for none, `null` for the default. */
  async setPageLimit(developerId: string, personId: string, limit: number | null): Promise<{ pageLimit: number | null }> {
    this.access.requireDeveloper(developerId);
    if (!isValidObjectId(personId)) throw new NotFoundException('Account not found.');
    const changed = await this.users.updateOne({ _id: personId, kind: { $ne: 'page' } }, limit === null ? { $unset: { pageLimit: '' } } : { $set: { pageLimit: limit } });
    if (!changed.matchedCount) throw new NotFoundException('Account not found.');
    return { pageLimit: limit };
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

  /** Spec 041: the person lets a linked AI assistant act as their pages marked "run with AI", or stops it. */
  async setAssistant(personId: string, enabled: boolean): Promise<{ assistant: boolean }> {
    await this.requireOn(personId);
    await this.users.updateOne({ _id: personId, kind: { $ne: 'page' } }, enabled ? { $set: { assistantPages: true } } : { $unset: { assistantPages: '' } });
    return { assistant: enabled };
  }

  /** Whether the person let an assistant manage pages at all (spec 041). */
  async assistantAllowed(personId: string): Promise<boolean> {
    if (!isValidObjectId(personId)) return false;
    const [person, { access }] = await Promise.all([this.users.findById(personId).select('assistantPages kind').lean(), this.access.forUser(personId)]);
    return !!person && person.kind !== 'page' && person.assistantPages === true && access.pages;
  }

  /**
   * The check behind everything an assistant does as a page (spec 041): the person allowed
   * assistants, still manages the page, the page is marked "run with AI", and it is not
   * suspended. Each failure has its own code, so the assistant can say what to change.
   */
  async assistantActingAs(personId: string, pageId: string): Promise<string> {
    if (!(await this.assistantAllowed(personId)))
      throw new ForbiddenException({ code: 'ASSISTANT_OFF', message: 'Assistants are not allowed to manage this account’s pages. The person turns that on in the app: Menu → AI assistant connections.' });
    if (!isValidObjectId(pageId)) throw notManager();
    const page = await this.users.findOne({ _id: pageId, kind: 'page', managers: personId }).select('suspendedAt aiManaged').lean();
    if (!page) throw notManager();
    if (page.suspendedAt) throw new ForbiddenException({ code: 'PAGE_SUSPENDED', message: 'This page has been suspended.' });
    if (!page.aiManaged)
      throw new ForbiddenException({ code: 'PAGE_NOT_AI', message: 'This page is not marked "run with AI", so an assistant cannot act as it. Its manager turns the mark on from the page’s profile in the app.' });
    return String(page._id);
  }

  /** Who answers for an account: a page's managers, or the person themselves. */
  async managersOf(accountId: string): Promise<string[]> {
    if (!isValidObjectId(accountId)) return [];
    const row = await this.users.findById(accountId).select('kind managers').lean();
    if (!row) return [];
    return row.kind === 'page' ? (row.managers ?? []) : [accountId];
  }

  /** The owner's override of the assistant's caps for one person; `null` returns them to the defaults. */
  async setAssistantCaps(developerId: string, personId: string, caps: Record<string, number> | null): Promise<{ caps: Record<string, number> | null }> {
    this.access.requireDeveloper(developerId);
    if (!isValidObjectId(personId)) throw new NotFoundException('Account not found.');
    const changed = await this.users.updateOne({ _id: personId, kind: { $ne: 'page' } }, caps === null ? { $unset: { assistantCaps: '' } } : { $set: { assistantCaps: caps } });
    if (!changed.matchedCount) throw new NotFoundException('Account not found.');
    return { caps };
  }

  /** A person's cap override and whether they are the owner, for the cap rule. */
  async assistantCapsOf(personId: string): Promise<{ override?: Record<string, number>; developer: boolean }> {
    const person = isValidObjectId(personId) ? await this.users.findById(personId).select('assistantCaps').lean() : null;
    return { ...(person?.assistantCaps ? { override: person.assistantCaps } : {}), developer: personId === this.config.developerUserId };
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

  /** Spec 041: let a linked AI assistant act as this person's "run with AI" pages, or stop it. */
  @Put('assistant')
  assistant(@CurrentUser('userId') personId: string, @Body() dto: AssistantDto) {
    return this.pages.setAssistant(personId, dto.enabled);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentUser('userId') personId: string, @Param('id') id: string) {
    return this.pages.remove(personId, id);
  }
}

const ADMIN_PAGE_SIZE = 30;

export class AdminListDto {
  @IsOptional() @IsIn(['people', 'pages']) kind?: 'people' | 'pages';
  @IsOptional() @IsString() @MaxLength(60) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) skip?: number;
}

export class PageLimitDto implements SetPageLimitRequest {
  @ValidateIf((dto: PageLimitDto) => dto.limit !== null) @IsInt() @Min(PAGE_LIMIT_NONE) @Max(PAGE_LIMIT_MAX) limit!: number | null;
}

/** The owner's People screen (spec 040): find an account, set its page limit. Developer only. */
@AsPerson()
@Controller('people-admin')
export class PeopleAdminController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser('userId') userId: string, @Query() query: AdminListDto): Promise<AdminAccountsPage> {
    return this.pages.adminList(userId, query);
  }

  @Put(':id/page-limit')
  pageLimit(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: PageLimitDto) {
    return this.pages.setPageLimit(userId, id, dto.limit);
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
  controllers: [PagesController, PageOfficialController, PeopleAdminController, IdentityController, FollowsController],
  providers: [PagesService, ActingGuard],
  exports: [PagesService, ActingGuard],
})
export class PagesModule {}
