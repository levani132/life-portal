import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CONFIG, type AppConfig } from '../config/configuration';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  ASSISTANT_ACTION_KINDS,
  ASSISTANT_CAP_MAX,
  ASSISTANT_CAP_NONE,
  ASSISTANT_SCHEDULE_MAX_DAYS,
  ASSISTANT_SCHEDULE_MAX_PENDING,
  ASSISTANT_SCHEDULE_MEDIA_MAX_HOURS,
  type AssistantScheduledAction,
  MAX_POST_MEDIA,
  MEAL_SLOTS,
  type MealSlot,
  MEDIA_LIMITS,
  EQUIPMENT_TYPES,
  MEASURES,
  MUSCLES,
  PLAN_TARGET_TYPES,
  PLAN_RULE_BASES,
  PLAN_RULE_KINDS,
  PLAN_RULE_METRICS,
  PLAN_RULE_SCOPES,
  type PlanRuleInput,
  type AssistantActionKind,
  type AssistantActivity,
  type AssistantOverview,
  type AssistantUpcoming,
  type AssistantCaps,
  type FoodPost,
} from '@life-portal/shared-types';
import { assistantCap, assistantDefaults, describePlanRule, underAssistantCap } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { FollowsService } from '../follows/follows.module';
import { MediaService } from '../media/media.service';
import { MessagesService } from '../messages/messages.service';
import { MealPlansService } from '../nutrition/meal-plans';
import { NutritionService } from '../nutrition/nutrition.service';
import { PagesService } from '../pages/pages.module';
import { ForYouService } from '../posts/for-you.service';
import { PostEngagementService } from '../posts/post-engagement.service';
import { PageInsightsService } from '../posts/page-insights.service';
import { PostsService } from '../posts/posts.service';
import { SocialService } from '../social/social.module';
import { CatalogueService } from '../training/catalogue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WORKER_INSTRUCTIONS, WORKER_INSTRUCTIONS_VERSION } from './worker-instructions';
import { ProgrammesService } from '../programmes/programmes.module';
import { PlansService } from '../training/plans.service';

/**
 * One thing an assistant did as a page (spec 041): which page, who linked the assistant, what
 * kind of action, which tool, and what it was done to. No content. Counted per page, kind and
 * day for the caps, and listed for the page's managers.
 */
@Schema({ collection: 'page_assistant_actions', timestamps: { createdAt: true, updatedAt: false }, versionKey: false })
export class PageAssistantAction {
  @Prop({ required: true }) pageId!: string;
  @Prop({ required: true }) personId!: string;
  @Prop({ type: String, required: true, enum: ASSISTANT_ACTION_KINDS }) kind!: AssistantActionKind;
  @Prop({ required: true }) tool!: string;
  @Prop() targetId?: string;
  /** The UTC day, for the daily count. */
  @Prop({ required: true }) day!: string;
  createdAt!: Date;
}
export const PageAssistantActionSchema = SchemaFactory.createForClass(PageAssistantAction);
PageAssistantActionSchema.index({ pageId: 1, kind: 1, day: 1 });
PageAssistantActionSchema.index({ pageId: 1, createdAt: -1 });
// Kept 90 days: long enough to see what happened, short enough not to grow for ever.
PageAssistantActionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

/**
 * Something an assistant asked to be done later as a page (spec 041). An assistant runs on its
 * own timetable (an hourly job, say), so it hands over what to do and when, and the server does
 * it at that minute. `args` is what the tool was called with: for a post or a comment that is
 * its text, kept until the action has run and for a week after.
 */
@Schema({ collection: 'page_scheduled_actions', timestamps: { createdAt: true, updatedAt: false }, versionKey: false })
export class PageScheduledAction {
  @Prop({ required: true }) pageId!: string;
  @Prop({ required: true }) personId!: string;
  @Prop({ required: true }) tool!: string;
  @Prop({ type: Object, required: true }) args!: Record<string, unknown>;
  @Prop({ required: true }) runAt!: Date;
  @Prop({ type: String, required: true, enum: ['pending', 'running', 'done', 'failed', 'cancelled'] }) status!: AssistantScheduledAction['status'];
  @Prop() error?: string;
  @Prop() startedAt?: Date;
  @Prop() doneAt?: Date;
  createdAt!: Date;
}
export const PageScheduledActionSchema = SchemaFactory.createForClass(PageScheduledAction);
PageScheduledActionSchema.index({ status: 1, runAt: 1 });
PageScheduledActionSchema.index({ pageId: 1, runAt: 1 });
// Finished rows are kept a week, for the managers' list, then removed with their text.
PageScheduledActionSchema.index({ doneAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60, sparse: true });

/** The tools that take `at`: done at that time instead of now. */
const SCHEDULABLE = new Set(['create_page_post', 'publish_page_draft', 'comment_on_post', 'like_post', 'like_comment', 'repost_post', 'follow_page', 'reply_in_conversation']);
/** How many due actions one run of the clock takes. */
const DUE_PER_RUN = 100;
/** A row left "running" this long was cut off by a restart; it is failed, never run twice. */
const STUCK_MS = 10 * 60 * 1000;

/** The owner's defaults for the assistant's caps: one row, no person. */
@Schema({ collection: 'assistant_settings', versionKey: false })
export class AssistantSettings {
  @Prop({ required: true, unique: true }) key!: string;
  @Prop({ type: Object }) caps?: Record<string, number>;
}
export const AssistantSettingsSchema = SchemaFactory.createForClass(AssistantSettings);

/** A tool the connector offers for pages: one definition for both MCP endpoints. */
export interface AssistantTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run(personId: string, args: Record<string, unknown>): Promise<unknown>;
}

const id = z.string().regex(/^[0-9a-f]{24}$/, 'A 24-character id.');
const pageId = id.describe('The page to act as: an id from list_my_pages. The page must be marked "run with AI".');
const username = z.string().regex(/^[a-z0-9][a-z0-9_-]{2,29}$/, '3–30 lowercase letters, numbers, underscores or hyphens.');
const cursor = z.string().max(256).optional().describe('The nextCursor of the previous answer, for the next page.');
const requestId = z.string().uuid().optional().describe('A UUID you choose; repeating a call with the same one does not do it twice.');
const mg = z.number().int().min(0).max(2_000_000);

const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

/** A post, cut down to what an assistant needs to read a feed. */
function brief(post: FoodPost) {
  const any = post as unknown as Record<string, unknown>;
  return {
    id: post.id,
    author: {
      id: post.author.userId,
      name: post.author.displayName,
      username: post.author.username,
      isPage: post.author.isPage === true,
      runWithAi: post.author.aiManaged === true,
    },
    title: post.title,
    caption: post.caption,
    audience: post.audience,
    createdAt: post.createdAt,
    ...(any['kind'] ? { food: any['kind'] } : {}),
    ...(any['training'] ? { training: true } : {}),
    photos: Array.isArray(any['media']) ? (any['media'] as unknown[]).length : 0,
    ...(any['repost'] ? { repost: true } : {}),
  };
}

@Injectable()
export class PageAssistantService {
  private readonly log = new Logger(PageAssistantService.name);

  constructor(
    @InjectModel(PageAssistantAction.name) private readonly actions: Model<PageAssistantAction>,
    @InjectModel(AssistantSettings.name) private readonly settings: Model<AssistantSettings>,
    private readonly access: AccessService,
    private readonly pages: PagesService,
    private readonly social: SocialService,
    private readonly posts: PostsService,
    private readonly engagement: PostEngagementService,
    private readonly forYou: ForYouService,
    private readonly nutrition: NutritionService,
    private readonly plans: PlansService,
    private readonly catalogue: CatalogueService,
    private readonly follows: FollowsService,
    private readonly messages: MessagesService,
    private readonly media: MediaService,
    private readonly mealPlans: MealPlansService,
    private readonly programmes: ProgrammesService,
    private readonly notifications: NotificationsService,
    @InjectModel(PageScheduledAction.name) private readonly scheduledActions: Model<PageScheduledAction>,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly insights: PageInsightsService,
  ) {}

  // ------------------------------------------------------------------ caps and the log

  async defaults(): Promise<AssistantCaps> {
    const row = await this.settings.findOne({ key: 'caps' }).lean();
    return assistantDefaults(row?.caps);
  }

  /** The owner changes the defaults every page gets. */
  async setDefaults(developerId: string, caps: AssistantCaps): Promise<AssistantCaps> {
    this.access.requireDeveloper(developerId);
    await this.settings.updateOne({ key: 'caps' }, { $set: { caps } }, { upsert: true });
    return this.defaults();
  }

  private async capFor(personId: string, kind: AssistantActionKind): Promise<number | null> {
    const [defaults, own] = await Promise.all([this.defaults(), this.pages.assistantCapsOf(personId)]);
    return assistantCap({ kind, defaults, override: own.override, developer: own.developer });
  }

  /** Refuses when today's count for this page and kind has reached the cap. */
  private async requireUnderCap(personId: string, page: string, kind: AssistantActionKind): Promise<void> {
    const cap = await this.capFor(personId, kind);
    if (cap === null) return;
    const used = await this.actions.countDocuments({ pageId: page, kind, day: utcDay() });
    if (!underAssistantCap(used, cap)) {
      throw new HttpException(
        { code: 'CAP_REACHED', message: `This page has reached today's limit for this kind of action (${cap}). It resets at midnight UTC.` },
        429,
      );
    }
  }

  private async record(personId: string, page: string, kind: AssistantActionKind, tool: string, targetId?: string): Promise<void> {
    await this.actions.create({ pageId: page, personId, kind, tool, day: utcDay(), ...(targetId ? { targetId } : {}) });
  }

  /** The page the assistant acts as, after every check. */
  private acting(personId: string, args: Record<string, unknown>): Promise<string> {
    return this.pages.assistantActingAs(personId, String(args['pageId'] ?? ''));
  }

  /** A counted action: checked against the cap, done, then written to the log. */
  private async counted<T>(
    personId: string,
    args: Record<string, unknown>,
    kind: AssistantActionKind,
    tool: string,
    work: (page: string) => Promise<{ result: T; targetId?: string }>,
  ): Promise<T> {
    const page = await this.acting(personId, args);
    await this.requireUnderCap(personId, page, kind);
    const { result, targetId } = await work(page);
    await this.record(personId, page, kind, tool, targetId);
    return result;
  }

  /** What the assistant did as a page, for its managers, with today's use against the caps. */
  async activity(personId: string, page: string, limit = 50): Promise<AssistantActivity> {
    if (!(await this.pages.managersOf(page)).includes(personId)) {
      throw new ForbiddenException({ code: 'NOT_A_MANAGER', message: 'You do not manage that page.' });
    }
    const waiting = await this.scheduledActions.find({ pageId: page, status: { $in: ['pending', 'running'] } }).sort({ runAt: 1 }).limit(100).lean<(PageScheduledAction & { _id: Types.ObjectId })[]>();
    const [rows, counts, defaults, own] = await Promise.all([
      this.actions.find({ pageId: page }).sort({ createdAt: -1 }).limit(Math.min(limit, 200)).lean<(PageAssistantAction & { _id: Types.ObjectId })[]>(),
      this.actions.aggregate<{ _id: AssistantActionKind; n: number }>([{ $match: { pageId: page, day: utcDay() } }, { $group: { _id: '$kind', n: { $sum: 1 } } }]),
      this.defaults(),
      this.pages.assistantCapsOf(personId),
    ]);
    const used = new Map(counts.map((row) => [row._id, row.n]));
    return {
      actions: rows.map((row) => ({
        id: String(row._id),
        kind: row.kind,
        tool: row.tool,
        ...(row.targetId ? { targetId: row.targetId } : {}),
        createdAt: row.createdAt.toISOString(),
      })),
      today: ASSISTANT_ACTION_KINDS.map((kind) => ({
        kind,
        used: used.get(kind) ?? 0,
        cap: assistantCap({ kind, defaults, override: own.override, developer: own.developer }),
      })),
      scheduled: waiting.map((row) => this.scheduledDto(row)),
    };
  }

  /**
   * Every page the person manages on one screen: what the assistant published today, what is
   * waiting, and what failed in the last day. Counts and the tools' own refusals, no content.
   */
  async overview(personId: string): Promise<AssistantOverview> {
    const [mine, allowed] = await Promise.all([this.pages.mine(personId), this.pages.assistantAllowed(personId)]);
    const ids = mine.pages.map((page) => page.id);
    if (!ids.length) return { allowed, pages: [] };
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [posted, queued, failed, last] = await Promise.all([
      this.actions.aggregate<{ _id: string; n: number }>([
        { $match: { pageId: { $in: ids }, day: utcDay(), tool: { $in: ['create_page_post', 'publish_page_draft'] } } },
        { $group: { _id: '$pageId', n: { $sum: 1 } } },
      ]),
      this.scheduledActions.aggregate<{ _id: string; n: number }>([{ $match: { pageId: { $in: ids }, status: 'pending' } }, { $group: { _id: '$pageId', n: { $sum: 1 } } }]),
      this.scheduledActions.aggregate<{ _id: string; n: number; error?: string }>([
        { $match: { pageId: { $in: ids }, status: 'failed', doneAt: { $gte: dayAgo } } },
        { $sort: { doneAt: 1 } },
        { $group: { _id: '$pageId', n: { $sum: 1 }, error: { $last: '$error' } } },
      ]),
      this.actions.aggregate<{ _id: string; at: Date }>([{ $match: { pageId: { $in: ids } } }, { $group: { _id: '$pageId', at: { $max: '$createdAt' } } }]),
    ]);
    const count = (rows: { _id: string; n: number }[]) => new Map(rows.map((row) => [row._id, row.n]));
    const [postedBy, queuedBy, failedBy] = [count(posted), count(queued), count(failed)];
    const errorBy = new Map(failed.map((row) => [row._id, row.error]));
    const lastBy = new Map(last.map((row) => [row._id, row.at]));
    return {
      allowed,
      pages: mine.pages.map((page) => ({
        id: page.id,
        name: page.name,
        username: page.username,
        ...(page.avatarUrl ? { avatarUrl: page.avatarUrl } : {}),
        runWithAi: page.aiManaged,
        official: page.official,
        suspended: page.suspended,
        disabled: page.disabled,
        postsToday: postedBy.get(page.id) ?? 0,
        queued: queuedBy.get(page.id) ?? 0,
        failed: failedBy.get(page.id) ?? 0,
        ...(errorBy.get(page.id) ? { lastError: errorBy.get(page.id) } : {}),
        ...(lastBy.get(page.id) ? { lastActionAt: (lastBy.get(page.id) as Date).toISOString() } : {}),
      })),
    };
  }

  /**
   * Every action waiting across the person's pages, soonest first, then what failed in the last
   * day: when each will happen and the first words of what will be said.
   */
  async upcoming(personId: string): Promise<AssistantUpcoming> {
    const mine = await this.pages.mine(personId);
    const byId = new Map(mine.pages.map((page) => [page.id, page]));
    if (!byId.size) return { items: [] };
    const ids = [...byId.keys()];
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    type Row = PageScheduledAction & { _id: Types.ObjectId };
    const [waiting, failed] = await Promise.all([
      this.scheduledActions.find({ pageId: { $in: ids }, status: { $in: ['pending', 'running'] } }).sort({ runAt: 1 }).limit(500).lean<Row[]>(),
      this.scheduledActions.find({ pageId: { $in: ids }, status: 'failed', doneAt: { $gte: dayAgo } }).sort({ doneAt: -1 }).limit(100).lean<Row[]>(),
    ]);
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
    return {
      items: [...waiting, ...failed].map((row) => {
        const page = byId.get(row.pageId);
        const args = row.args ?? {};
        const said = text(args['title']) ?? text(args['caption']) ?? text(args['text']);
        const photos = Array.isArray(args['mediaIds']) ? args['mediaIds'].length : 0;
        const attaches = (
          [
            ['foodId', 'food'],
            ['recipeId', 'recipe'],
            ['mealPlanId', 'meal plan'],
            ['planId', 'training plan'],
          ] as const
        )
          .filter(([key]) => text(args[key]))
          .map(([, label]) => label);
        return {
          ...this.scheduledDto(row),
          pageId: row.pageId,
          pageName: page?.name ?? '',
          pageUsername: page?.username ?? '',
          ...(page?.avatarUrl ? { avatarUrl: page.avatarUrl } : {}),
          ...(said ? { preview: said.length > 140 ? `${said.slice(0, 139)}…` : said } : {}),
          ...(photos ? { photos } : {}),
          ...(attaches.length ? { attaches: [...attaches] } : {}),
        };
      }),
    };
  }

  /** A manager calls off something waiting, as the assistant's own cancel tool does. */
  async cancelScheduled(personId: string, actionId: string): Promise<{ cancelled: boolean }> {
    if (!isValidObjectId(actionId)) throw new NotFoundException('That action is not waiting.');
    const row = await this.scheduledActions.findById(actionId).select('pageId status').lean();
    if (!row || !(await this.pages.managersOf(row.pageId)).includes(personId)) throw new NotFoundException('That action is not waiting.');
    const result = await this.scheduledActions.updateOne({ _id: actionId, status: 'pending' }, { $set: { status: 'cancelled', doneAt: new Date() } });
    if (!result.modifiedCount) throw new ConflictException({ code: 'NOT_WAITING', message: 'It has already run or been cancelled.' });
    return { cancelled: true };
  }

  // ------------------------------------------------------------------ doing things later

  private scheduledDto(row: PageScheduledAction & { _id: Types.ObjectId }): AssistantScheduledAction {
    return { id: String(row._id), tool: row.tool, at: row.runAt.toISOString(), status: row.status, ...(row.error ? { error: row.error } : {}) };
  }

  /**
   * Queues a tool call for later. Everything is checked now that can be (the page, the time, the
   * photos); the caps and the page's state are checked again when it runs, on that day.
   */
  private async schedule(personId: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const page = await this.acting(personId, args);
    const runAt = new Date(String(args['at']));
    const now = Date.now();
    if (Number.isNaN(runAt.getTime())) throw new BadRequestException('"at" must be a date and time, like 2026-12-01T09:30:00Z.');
    if (runAt.getTime() < now + 30_000) throw new BadRequestException('"at" must be in the future. Leave it out to do this now.');
    if (runAt.getTime() > now + ASSISTANT_SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000)
      throw new BadRequestException(`"at" can be at most ${ASSISTANT_SCHEDULE_MAX_DAYS} days ahead.`);
    const mediaIds = (args['mediaIds'] as string[] | undefined) ?? [];
    if (mediaIds.length) {
      // An upload nobody attached is deleted after a day, so a post with photos cannot wait longer.
      if (runAt.getTime() > now + ASSISTANT_SCHEDULE_MEDIA_MAX_HOURS * 60 * 60 * 1000)
        throw new BadRequestException(`A post with photos can be scheduled at most ${ASSISTANT_SCHEDULE_MEDIA_MAX_HOURS} hours ahead.`);
      await this.media.requireAssistantChecked(page, mediaIds);
    }
    const pending = await this.scheduledActions.countDocuments({ pageId: page, status: 'pending' });
    if (pending >= ASSISTANT_SCHEDULE_MAX_PENDING) throw new HttpException({ code: 'CAP_REACHED', message: 'This page already has as many actions waiting as it may. Let some run or cancel some.' }, 429);
    const { at: _at, ...rest } = args;
    // A fixed request id, so running it can never post or comment twice.
    const stored = { ...rest, pageId: page, ...(tool === 'create_page_post' || tool === 'comment_on_post' || tool === 'reply_in_conversation' ? { requestId: (rest['requestId'] as string | undefined) ?? randomUUID() } : {}) };
    const row = await this.scheduledActions.create({ pageId: page, personId, tool, args: stored, runAt, status: 'pending' });
    return { scheduled: true, actionId: String(row._id), tool, at: runAt.toISOString(), note: 'It will be done at that time, if the page is still usable and under its daily limits then. See list_scheduled_actions.' };
  }

  /** Every minute: does what is due. One at a time, each claimed first so two servers never both run it. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'page-scheduled-actions' })
  async tick(): Promise<void> {
    if (this.config.disableSchedules) return;
    await this.runDue();
  }

  /** Does everything due at `now`; answers how many it took. */
  async runDue(now = new Date()): Promise<number> {
    await this.scheduledActions.updateMany(
      { status: 'running', startedAt: { $lt: new Date(now.getTime() - STUCK_MS) } },
      { $set: { status: 'failed', error: 'Interrupted by a restart; not run again, in case it had already happened.', doneAt: now } },
    );
    const tools = new Map(this.baseTools().map((tool) => [tool.name, tool]));
    let ran = 0;
    for (; ran < DUE_PER_RUN; ran++) {
      const row = await this.scheduledActions
        .findOneAndUpdate({ status: 'pending', runAt: { $lte: now } }, { $set: { status: 'running', startedAt: new Date() } }, { sort: { runAt: 1 } })
        .lean<PageScheduledAction & { _id: Types.ObjectId }>();
      if (!row) break;
      let error: string | undefined;
      try {
        const tool = tools.get(row.tool);
        if (!tool) throw new BadRequestException('That action can no longer be done.');
        await tool.run(row.personId, row.args);
      } catch (caught) {
        const response = (caught as { getResponse?: () => unknown }).getResponse?.();
        const body = response && typeof response === 'object' ? (response as { message?: unknown; code?: unknown }) : undefined;
        const message = body ? (Array.isArray(body.message) ? body.message.join('; ') : String(body.message ?? 'Refused.')) : typeof response === 'string' ? response : 'Something went wrong.';
        error = body && typeof body.code === 'string' ? `${body.code}: ${message}` : message;
        if (!response) this.log.warn(`Scheduled ${row.tool} failed: ${(caught as Error).name}`);
      }
      await this.scheduledActions.updateOne({ _id: row._id }, { $set: { status: error ? 'failed' : 'done', doneAt: new Date(), ...(error ? { error: error.slice(0, 500) } : {}) } });
    }
    return ran;
  }

  // ------------------------------------------------------------------ the tools

  /**
   * The tools as an assistant gets them: those that can wait take an optional `at`, and with it
   * the call is queued instead of done.
   */
  tools(): AssistantTool[] {
    const at = z
      .string()
      .max(40)
      .optional()
      .describe(
        `Optional. When to do this instead of now: an ISO date and time with its offset, like 2026-12-01T09:30:00+04:00, up to ${ASSISTANT_SCHEDULE_MAX_DAYS} days ahead (a post with photos: ${ASSISTANT_SCHEDULE_MEDIA_MAX_HOURS} hours). The server does it at that minute; nothing else is needed from you.`,
      );
    return this.baseTools().map((tool) =>
      SCHEDULABLE.has(tool.name)
        ? {
            ...tool,
            shape: { ...tool.shape, at },
            run: (personId: string, args: Record<string, unknown>) => (args['at'] ? this.schedule(personId, tool.name, args) : tool.run(personId, args)),
          }
        : tool,
    );
  }

  private baseTools(): AssistantTool[] {
    /** Spec 042/043: a meal plan as the assistant writes it, for create and update alike. */
    const mealPlanShape = {
      pageId,
      name: z.string().min(1).max(80),
      description: z.string().max(500).optional(),
      rules: z
        .array(
          z.object({
            metric: z.enum(PLAN_RULE_METRICS).describe('energy is calories'),
            scope: z.enum(PLAN_RULE_SCOPES).describe('day, or one meal'),
            kind: z.enum(PLAN_RULE_KINDS),
            basis: z.enum(PLAN_RULE_BASES).describe('amount; perKg of current weight; perKgTarget of target weight; share: percent of calories (a macro), or of the day (calories at a meal)'),
            value: z.number().positive().optional().describe('For atLeast, atMost, about. Grams for a macro (150 = 150 g), kcal for calories, g or kcal per kg, or percent.'),
            low: z.number().positive().optional().describe('For between, in the same unit.'),
            high: z.number().positive().optional(),
            tolerancePct: z.number().int().min(1).max(50).optional().describe('For about; default 10.'),
            each: z.boolean().optional().describe('Checked on each food, not the total: then basis is amount (in the food as eaten), per100 (per 100 g) or share (of its own calories). Sugar and satFat rules are always on each food.'),
            dayIndex: z.number().int().min(0).max(13).optional().describe('Only for that day of the plan; absent: every day.'),
          }),
        )
        .max(20)
        .optional(),
      days: z
        .array(
          z.object({
            name: z.string().min(1).max(40),
            lines: z
              .array(z.object({
                meal: z.enum(MEAL_SLOTS),
                alsoAt: z.array(z.enum(MEAL_SLOTS)).max(4).optional(),
                options: z
                  .array(z.object({ recipeId: id.optional(), foodId: id.optional(), amount: z.number().int().min(1).max(20_000).optional() }))
                  .max(5)
                  .optional()
                  .describe('Other things that may be eaten instead (chicken, or pork, or tofu): each a recipe or a food with an amount.'),
                recipeId: id.optional(), foodId: id.optional(), amount: z.number().int().min(1).max(20_000).optional() }))
              .max(20),
          }),
        )
        .max(14),
    };
    const mealPlanInput = (args: Record<string, unknown>) => {
      const days = (args['days'] as { name: string; lines: { meal: MealSlot; alsoAt?: MealSlot[]; options?: { recipeId?: string; foodId?: string; amount?: number }[]; recipeId?: string; foodId?: string; amount?: number }[] }[]).map((day) => ({
        name: day.name,
        entries: day.lines.map((line) => ({
          slot: line.meal,
          ...(line.options?.length
            ? { options: line.options.map((option) => (option.recipeId ? { savedMealId: option.recipeId } : { foodId: option.foodId, amount: option.amount })) }
            : {}),
          ...(line.alsoAt?.length ? { slots: [...new Set([line.meal, ...line.alsoAt])] } : {}),
          ...(line.recipeId ? { savedMealId: line.recipeId } : { foodId: line.foodId, amount: line.amount }) })),
      }));
      // Rules come in the units people use (g, kcal, g per kg, %) and are stored as integers (mg).
      type RuleArg = Omit<PlanRuleInput, 'id'> & { dayIndex?: number };
      const toStored = (rule: RuleArg): PlanRuleInput => {
        const mg = rule.metric !== 'energy' && rule.basis !== 'share';
        const n = (x: number | undefined) => (x === undefined ? undefined : Math.round(mg ? x * 1000 : x));
        const { dayIndex: _dayIndex, ...rest } = rule;
        return { ...rest, value: n(rule.value), low: n(rule.low), high: n(rule.high) };
      };
      const ruleArgs = (args['rules'] as RuleArg[] | undefined) ?? [];
      const planDays = days.map((day, index) => ({ ...day, rules: ruleArgs.filter((rule) => rule.dayIndex === index).map(toStored) }));
      return {
        name: String(args['name']),
        description: args['description'] as string | undefined,
        rules: ruleArgs.filter((rule) => rule.dayIndex === undefined).map(toStored),
        days: planDays,
      };
    };
    const food = {
      name: z.string().min(1).max(160),
      brand: z.string().max(120).optional(),
      unit: z.enum(['g', 'ml']).optional().describe('Defaults to g.'),
      servingSize: z.number().int().min(1).max(5000).describe('One serving, in the unit.'),
      servingLabel: z.string().max(60).optional(),
      energyKcal: z.number().int().min(0).max(9000).describe('Per 100 of the unit.'),
      proteinMg: mg.describe('Protein per 100 of the unit, in milligrams (20 g = 20000).'),
      fatMg: mg.describe('Fat per 100, in milligrams.'),
      carbMg: mg.describe('Carbohydrate per 100, in milligrams.'),
      fibreMg: mg.optional(),
      sugarMg: mg.optional(),
      satFatMg: mg.optional(),
      sodiumMg: mg.optional(),
      notes: z.string().max(500).optional(),
    };
    const target = z.object({
      type: z.enum(PLAN_TARGET_TYPES),
      reps: z.number().int().min(0).max(1000).optional(),
      repsMax: z.number().int().min(0).max(1000).optional(),
      weightGrams: z.number().int().min(0).max(2_000_000).optional(),
      durationSeconds: z.number().int().min(0).max(86_400).optional(),
      distanceMeters: z.number().int().min(0).max(1_000_000).optional(),
    });
    const workouts = z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          exercises: z
            .array(
              z.object({
                exerciseId: id.describe('From list_page_exercises.'),
                restSeconds: z.number().int().min(0).max(3600).optional(),
                note: z.string().max(300).optional(),
                targets: z.array(target).min(1).max(20).describe('One per planned set.'),
              }),
            )
            .max(40),
        }),
      )
      .min(1)
      .max(14);

    const tools: AssistantTool[] = [
      // ---- pages
      {
        name: 'list_my_pages',
        description:
          'List the pages this person manages, and which ones an assistant may act as. An assistant may act only as a page marked "run with AI", and only once the person allowed assistants to manage pages in the app.',
        shape: {},
        run: async (personId) => {
          const [mine, allowed] = await Promise.all([this.pages.mine(personId), this.pages.assistantAllowed(personId)]);
          const marked = mine.pages.some((page) => page.aiManaged);
          return {
            assistantAllowed: allowed,
            // What the person has to do, in words the assistant can pass on.
            ...(allowed
              ? marked || !mine.pages.length
                ? {}
                : { note: 'None of these pages is marked "run with AI". The person marks one from the page’s own profile in the app, or you can create a new page, which is marked from the start.' }
              : { note: 'Not allowed yet. The person turns it on in the app: Menu → AI assistant connections → "Let a connected assistant manage my pages". A page must also be marked "run with AI" to be usable.' }),
            canCreateMore: mine.remaining === null ? 'no limit' : mine.remaining,
            pages: mine.pages.map((page) => ({
              id: page.id,
              name: page.name,
              username: page.username,
              bio: page.bio,
              runWithAi: page.aiManaged,
              hasPhoto: !!page.avatarUrl,
              suspended: page.suspended,
              disabled: page.disabled,
              usable: allowed && page.aiManaged && !page.suspended && !page.disabled,
            })),
          };
        },
      },
      {
        name: 'create_page',
        description:
          'Create a new page for this person. A page is an account that is not a person: it publishes content and is always shown as a page. A page created here is marked "run with AI". Counts toward the person’s page limit.',
        shape: { name: z.string().min(1).max(80), username, bio: z.string().max(300).optional() },
        run: async (personId, args) => {
          if (!(await this.pages.assistantAllowed(personId))) {
            throw new ForbiddenException({
              code: 'ASSISTANT_OFF',
              message: 'Assistants are not allowed to manage this account’s pages. The person turns that on in the app: Menu → AI assistant connections.',
            });
          }
          const page = await this.pages.create(personId, { name: String(args['name']), username: String(args['username']), bio: args['bio'] as string | undefined }, { aiManaged: true });
          return { id: page.id, name: page.name, username: page.username, runWithAi: true };
        },
      },
      {
        name: 'update_page',
        description: 'Change a page’s name, username or description.',
        shape: { pageId, name: z.string().min(1).max(80), username, bio: z.string().max(300) },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const updated = await this.pages.update(personId, page, { name: String(args['name']), username: String(args['username']), bio: String(args['bio']) });
          return { id: updated.id, name: updated.name, username: updated.username, bio: updated.bio };
        },
      },
      {
        name: 'disable_page',
        description:
          'Switch a page off: it is hidden from everyone and nobody can use the app as it, but nothing is deleted. Only the page’s manager can switch it on again, in the app. An assistant cannot delete a page.',
        shape: { pageId },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          await this.record(personId, page, 'library', 'disable_page', page);
          const summary = await this.pages.setDisabled(personId, page, true);
          return { id: summary.id, name: summary.name, disabled: true };
        },
      },
      {
        name: 'get_worker_instructions',
        description:
          'The current instructions for one of the owner’s page workers (A to E). A worker’s scheduled task loads them at the start of every run and follows them, so updating the instructions in the app updates every worker. Only for the app’s owner.',
        shape: { worker: z.enum(['A', 'B', 'C', 'D', 'E']) },
        run: async (personId, args) => {
          if (!this.config.developerUserId || this.config.developerUserId !== personId)
            throw new ForbiddenException({ code: 'NOT_THE_OWNER', message: 'Worker instructions are for the app’s owner only.' });
          const worker = String(args['worker']) as keyof typeof WORKER_INSTRUCTIONS;
          return { worker, version: WORKER_INSTRUCTIONS_VERSION, instructions: WORKER_INSTRUCTIONS[worker] };
        },
      },
      {
        name: 'list_scheduled_actions',
        description: 'What is queued to be done later as this page, soonest first, and what ran or failed in the last week.',
        shape: { pageId },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const rows = await this.scheduledActions.find({ pageId: page }).sort({ runAt: 1 }).limit(200).lean<(PageScheduledAction & { _id: Types.ObjectId })[]>();
          return rows.map((row) => this.scheduledDto(row));
        },
      },
      {
        name: 'cancel_scheduled_action',
        description: 'Cancel something queued for later that has not run yet.',
        shape: { pageId, actionId: id },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const result = await this.scheduledActions.updateOne({ _id: String(args['actionId']), pageId: page, status: 'pending' }, { $set: { status: 'cancelled', doneAt: new Date() } });
          if (!result.matchedCount) throw new BadRequestException('That action is not waiting any more: it ran, failed or was cancelled.');
          return { cancelled: true };
        },
      },
      {
        name: 'get_assistant_activity',
        description: 'What the assistant did as a page recently, and today’s use against the page’s daily limits.',
        shape: { pageId },
        run: async (personId, args) => this.activity(personId, await this.acting(personId, args)),
      },

      // ---- library: foods and recipes
      {
        name: 'list_page_foods',
        description: 'The foods in a page’s library.',
        shape: { pageId, q: z.string().max(80).optional() },
        run: async (personId, args) => {
          const foods = await this.nutrition.listFoods(await this.acting(personId, args), { q: args['q'] as string | undefined });
          return foods.map((row) => ({ id: row.id, name: row.name, brand: row.brand, unit: row.unit, servingSize: row.servingSize, perServing: row.perServing }));
        },
      },
      {
        name: 'create_page_food',
        description: 'Add a food to a page’s library. Numbers are per 100 g or 100 ml; macros in milligrams.',
        shape: { pageId, ...food },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'create_page_food', async (page) => {
            const { pageId: _page, ...dto } = args;
            const created = await this.nutrition.createFood(page, { entryMode: 'per_100', ...dto } as never);
            return { result: { id: created.id, name: created.name }, targetId: created.id };
          }),
      },
      {
        name: 'update_page_food',
        description: 'Change a food in a page’s library. Send the whole food again.',
        shape: { pageId, foodId: id, ...food },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'update_page_food', async (page) => {
            const { pageId: _page, foodId, ...dto } = args;
            const updated = await this.nutrition.updateFood(page, String(foodId), { entryMode: 'per_100', ...dto } as never);
            return { result: { id: updated.id, name: updated.name }, targetId: updated.id };
          }),
      },
      {
        name: 'delete_page_food',
        description: 'Remove a food from a page’s library. A food already used in posts is archived, not erased.',
        shape: { pageId, foodId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'delete_page_food', async (page) => ({
            result: await this.nutrition.removeFood(page, String(args['foodId'])),
            targetId: String(args['foodId']),
          })),
      },
      {
        name: 'list_page_recipes',
        description: 'The recipes in a page’s library: named sets of the page’s foods with amounts.',
        shape: { pageId },
        run: async (personId, args) => {
          const meals = await this.nutrition.listSavedMeals(await this.acting(personId, args));
          return meals.map((meal) => ({
            id: meal.id,
            name: meal.name,
            totals: meal.totals,
            foods: meal.components.map((component) => ({ foodId: component.foodId, name: component.name, amount: component.amount, unit: component.unit })),
            ...(meal.ingredients?.length ? { ingredients: meal.ingredients } : {}),
            ...(meal.steps?.length ? { steps: meal.steps } : {}),
          }));
        },
      },
      {
        name: 'create_page_recipe',
        description:
          'Create a recipe. Give its foods from the page’s library with amounts (in each food’s own unit, g or ml) so it has nutrition numbers; add the method as steps. A recipe with no numbers is allowed: write its ingredients as lines instead of foods. At least one of foods, ingredients or steps.',
        shape: {
          pageId,
          name: z.string().min(1).max(120),
          foods: z.array(z.object({ foodId: id, amount: z.number().int().min(1).max(10_000) })).max(20).optional(),
          ingredients: z.array(z.string().min(1).max(200)).max(40).optional().describe('Ingredients written out, one per line, for what has no food with numbers.'),
          steps: z.array(z.string().min(1).max(600)).max(30).optional().describe('The method, one step per entry.'),
        },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'create_page_recipe', async (page) => {
            const created = await this.nutrition.createSavedMeal(page, { name: String(args['name']), components: args['foods'] ?? [], ingredients: args['ingredients'], steps: args['steps'] } as never);
            return { result: { id: created.id, name: created.name, totals: created.totals }, targetId: created.id };
          }),
      },
      {
        name: 'update_page_recipe',
        description: 'Change a recipe in a page’s library: its name, its foods with amounts, its written ingredients or its steps. Only what you send changes; a list you send replaces that list.',
        shape: {
          pageId,
          recipeId: id,
          name: z.string().min(1).max(120).optional(),
          foods: z.array(z.object({ foodId: id, amount: z.number().int().min(1).max(10_000) })).max(20).optional(),
          ingredients: z.array(z.string().min(1).max(200)).max(40).optional(),
          steps: z.array(z.string().min(1).max(600)).max(30).optional(),
        },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'update_page_recipe', async (page) => {
            const updated = await this.nutrition.updateSavedMeal(page, String(args['recipeId']), {
              ...(args['name'] !== undefined ? { name: String(args['name']) } : {}),
              ...(args['foods'] !== undefined ? { components: args['foods'] } : {}),
              ...(args['ingredients'] !== undefined ? { ingredients: args['ingredients'] } : {}),
              ...(args['steps'] !== undefined ? { steps: args['steps'] } : {}),
            } as never);
            return { result: { id: updated.id, name: updated.name, totals: updated.totals }, targetId: updated.id };
          }),
      },
      {
        name: 'delete_page_recipe',
        description: 'Remove a recipe from a page’s library.',
        shape: { pageId, recipeId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'delete_page_recipe', async (page) => ({
            result: await this.nutrition.removeSavedMeal(page, String(args['recipeId'])),
            targetId: String(args['recipeId']),
          })),
      },

      // ---- library: meal plans
      {
        name: 'list_page_meal_plans',
        description: 'The meal plans in a page’s library: days of meals, with each day’s totals and the average day.',
        shape: { pageId },
        run: async (personId, args) => {
          const plans = await this.mealPlans.list(await this.acting(personId, args));
          return plans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            description: plan.description,
            complete: plan.complete,
            dailyAverage: plan.dailyAverage,
            rules: plan.rules.map((rule) => describePlanRule(rule)),
            days: plan.days.map((day) => ({ name: day.name, totals: day.totals, rules: (day.rules ?? []).map((rule) => describePlanRule(rule)), lines: day.entries.map((entry) => ({ meal: entry.slot, ...(entry.slots ? { alsoAt: entry.slots.slice(1) } : {}), name: entry.name, amount: entry.amount, ...(entry.options?.length ? { or: entry.options.map((option) => ({ name: option.name, amount: option.amount })) } : {}) })) })),
          }));
        },
      },
      {
        name: 'create_page_meal_plan',
        description:
          'Create a meal plan in a page’s library: one to fourteen named days ("Training day", "Rest day", or "Day 1"), each a list of lines. A plan may also have rules (numbers to aim for), and may be rules only with no days. A line is a meal (breakfast, lunch, dinner, snack), or several in `alsoAt` when it may be eaten at any of them (lunch or dinner; all four for any time), with either a recipe from the library (recipeId) or one food with an amount in its own unit (foodId and amount). Use recipes and foods that have numbers.',
        shape: mealPlanShape,
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'create_page_meal_plan', async (page) => {
            const created = await this.mealPlans.create(page, mealPlanInput(args));
            return { result: { id: created.id, name: created.name, dailyAverage: created.dailyAverage, complete: created.complete }, targetId: created.id };
          }),
      },
      {
        name: 'update_page_meal_plan',
        description:
          'Replace a meal plan in a page’s library: send it whole, as for create_page_meal_plan (name, rules, days). Read it first with list_page_meal_plans.',
        shape: { ...mealPlanShape, mealPlanId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'update_page_meal_plan', async (page) => {
            const updated = await this.mealPlans.replace(page, String(args['mealPlanId']), mealPlanInput(args));
            return { result: { id: updated.id, name: updated.name, dailyAverage: updated.dailyAverage, complete: updated.complete }, targetId: updated.id };
          }),
      },
      {
        name: 'delete_page_meal_plan',
        description: 'Remove a meal plan from a page’s library.',
        shape: { pageId, mealPlanId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'delete_page_meal_plan', async (page) => ({
            result: await this.mealPlans.remove(page, String(args['mealPlanId'])),
            targetId: String(args['mealPlanId']),
          })),
      },

      // ---- library: programmes (spec 042/043)
      {
        name: 'list_page_programmes',
        description: 'A page’s programmes: each pairs a meal plan and a training plan from its library under one name.',
        shape: { pageId },
        run: async (personId, args) => this.programmes.list(await this.acting(personId, args)),
      },
      {
        name: 'create_page_programme',
        description:
          'Pair a meal plan and/or a training plan from a page’s library under one name. Make the plans first (create_page_meal_plan, create_page_plan). To share it, post with create_page_post with both mealPlanId and planId: readers can follow the whole programme in one tap.',
        shape: { pageId, name: z.string().min(1).max(80), description: z.string().max(500).optional(), mealPlanId: id.optional(), planId: id.optional() },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'create_page_programme', async (page) => {
            const created = await this.programmes.create(page, {
              name: String(args['name']),
              description: args['description'] as string | undefined,
              mealPlanId: args['mealPlanId'] as string | undefined,
              trainingPlanId: args['planId'] as string | undefined,
            });
            return { result: created, targetId: created.id };
          }),
      },
      {
        name: 'update_page_programme',
        description: 'Change a programme: its name, description, meal plan or training plan. Send the whole programme; a plan left out is taken out of it.',
        shape: { pageId, programmeId: id, name: z.string().min(1).max(80), description: z.string().max(500).optional(), mealPlanId: id.optional(), planId: id.optional() },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'update_page_programme', async (page) => {
            const updated = await this.programmes.replace(page, String(args['programmeId']), {
              name: String(args['name']),
              description: args['description'] as string | undefined,
              mealPlanId: args['mealPlanId'] as string | undefined,
              trainingPlanId: args['planId'] as string | undefined,
            });
            return { result: updated, targetId: updated.id };
          }),
      },
      {
        name: 'delete_page_programme',
        description: 'Remove a programme from a page’s library. Its meal plan and training plan stay.',
        shape: { pageId, programmeId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'delete_page_programme', async (page) => ({
            result: await this.programmes.remove(page, String(args['programmeId'])),
            targetId: String(args['programmeId']),
          })),
      },

      // ---- library: training
      {
        name: 'list_page_exercises',
        description: 'Exercises a page can use in plans: the shared catalogue and the page’s own. Search by name.',
        shape: { pageId, q: z.string().max(80).optional(), limit: z.number().int().min(1).max(50).optional() },
        run: async (personId, args) => {
          const rows = await this.catalogue.list(await this.acting(personId, args), { q: args['q'] as string | undefined, limit: (args['limit'] as number | undefined) ?? 25 });
          return rows.map((row) => {
            const any = row as unknown as Record<string, unknown>;
            return { id: any['id'], name: any['name'], measure: any['measure'], equipmentType: any['equipmentType'], primaryMuscles: any['primaryMuscles'], own: any['isOwn'] };
          });
        },
      },
      {
        name: 'create_page_exercise',
        description: 'Add an exercise of the page’s own, when the catalogue does not have it.',
        shape: {
          pageId,
          name: z.string().min(1).max(120),
          primaryMuscles: z.array(z.enum(MUSCLES)).min(1),
          secondaryMuscles: z.array(z.enum(MUSCLES)).optional(),
          equipmentType: z.enum(EQUIPMENT_TYPES),
          measure: z.enum(MEASURES),
          instructions: z.array(z.string().max(500)).max(20).optional(),
        },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'create_page_exercise', async (page) => {
            const { pageId: _page, ...input } = args;
            const created = await this.catalogue.create(page, input as never);
            return { result: { id: created.id, name: created.name }, targetId: created.id };
          }),
      },
      {
        name: 'list_page_plans',
        description: 'The training plans in a page’s library.',
        shape: { pageId },
        run: async (personId, args) => {
          const list = await this.plans.list(await this.acting(personId, args));
          return list.own.map((plan) => ({ id: plan.id, name: plan.name, description: plan.description, workouts: plan.workoutCount, exercises: plan.exerciseCount }));
        },
      },
      {
        name: 'get_page_plan',
        description: 'One training plan in full: its workouts, exercises and planned sets.',
        shape: { pageId, planId: id },
        run: async (personId, args) => this.plans.detail(await this.acting(personId, args), String(args['planId'])),
      },
      {
        name: 'create_page_plan',
        description:
          'Create a training plan in a page’s library: one or more workouts, each a list of exercises with planned sets. Weights are in grams (60 kg = 60000).',
        shape: { pageId, name: z.string().min(1).max(80), description: z.string().max(500).optional(), workouts, requestId },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'create_page_plan', async (page) => {
            const created = await this.plans.create(page, {
              requestId: (args['requestId'] as string | undefined) ?? randomUUID(),
              name: String(args['name']),
              ...(args['description'] ? { description: String(args['description']) } : {}),
              workouts: args['workouts'] as never,
            });
            return { result: { id: created.id, name: created.name }, targetId: created.id };
          }),
      },
      {
        name: 'update_page_plan',
        description: 'Replace a training plan in a page’s library: send it whole, as for create_page_plan. Read it first with get_page_plan.',
        shape: { pageId, planId: id, name: z.string().min(1).max(80), description: z.string().max(500).optional(), workouts },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'update_page_plan', async (page) => {
            const updated = await this.plans.replace(page, String(args['planId']), {
              name: String(args['name']),
              ...(args['description'] ? { description: String(args['description']) } : {}),
              workouts: args['workouts'] as never,
            });
            return { result: { id: updated.id, name: updated.name }, targetId: updated.id };
          }),
      },
      {
        name: 'delete_page_plan',
        description: 'Remove a training plan from a page’s library.',
        shape: { pageId, planId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'delete_page_plan', async (page) => ({
            result: await this.plans.remove(page, String(args['planId'])),
            targetId: String(args['planId']),
          })),
      },

      // ---- photos (video can join this flow later)
      {
        name: 'prepare_page_media_upload',
        description:
          'Step 1 of 3 to put a photo on a page’s post. Answers a one-time upload link. Before calling: convert the picture to JPEG, make its longest edge 2048 pixels or less, and measure the file. Step 2: send the file with an HTTP PUT to uploadUrl with exactly the headers given (the link accepts only that size and type, for 15 minutes). Step 3: call finish_page_media_upload. Only upload pictures the page has the right to use.',
        shape: {
          pageId,
          kind: z.enum(['image']).describe('Only "image" for now.'),
          bytes: z.number().int().min(1).max(MEDIA_LIMITS.image.maxBytes).describe('The exact size of the JPEG file in bytes.'),
          width: z.number().int().min(1).max(8192),
          height: z.number().int().min(1).max(8192),
        },
        run: (personId, args) =>
          this.counted(personId, args, 'media', 'prepare_page_media_upload', async (page) => {
            const ticket = await this.media.assistantTicket(page, { kind: 'image', bytes: Number(args['bytes']), width: Number(args['width']), height: Number(args['height']) });
            return {
              result: { mediaId: ticket.id, uploadUrl: ticket.uploadUrl, method: 'PUT', headers: ticket.headers, expiresInSeconds: ticket.expiresInSeconds, next: 'PUT the file, then call finish_page_media_upload with this mediaId.' },
              targetId: ticket.id,
            };
          }),
      },
      {
        name: 'finish_page_media_upload',
        description:
          'Step 3 of 3: after the file was sent to the upload link, checks it (a real JPEG within the limits) and removes hidden details such as location data. Answers the mediaId to pass in mediaIds of create_page_post. A file that is not a JPEG is deleted and refused.',
        shape: { pageId, mediaId: id },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const checked = await this.media.finishAssistantUpload(page, String(args['mediaId']));
          return { mediaId: checked.id, width: checked.width, height: checked.height, ready: true };
        },
      },

      {
        name: 'set_page_photo',
        description:
          'Set the page’s profile photo from an uploaded picture: a mediaId from finish_page_media_upload. Use a square picture that says what the page is about, with no text, logos or recognisable people. It is checked like any profile photo.',
        shape: { pageId, mediaId: id },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const mediaId = String(args['mediaId']);
          await this.media.requireAssistantChecked(page, [mediaId]);
          await this.social.setAvatar(page, { mediaId });
          await this.record(personId, page, 'media', 'set_page_photo', mediaId);
          return { photoSet: true };
        },
      },

      // ---- posts
      {
        name: 'create_page_post',
        description:
          'Publish a post as a page, or save it as a draft (draft: true) that only the page’s managers see until it is published. A post is text, and may carry items from the page’s library for people to save or copy: a food or a recipe, a training plan or an exercise, or a meal plan; and with any of those, a training plan or an exercise too (a meal plan with the training plan it goes with is a full programme). Present library content as something to save, never as something the page ate or did.',
        shape: {
          pageId,
          caption: z.string().max(1000),
          title: z.string().max(120).optional(),
          draft: z.boolean().optional(),
          foodId: id.optional(),
          recipeId: id.optional(),
          mealPlanId: id.optional().describe('A meal plan from the library, shown day by day; readers can save it as their own.'),
          planId: id.optional(),
          exerciseId: id.optional(),
          mediaIds: z.array(id).max(MAX_POST_MEDIA).optional().describe('Photos to show on the post: ids from finish_page_media_upload, in order.'),
          requestId,
        },
        run: (personId, args) =>
          this.counted(personId, args, 'post', 'create_page_post', async (page) => {
            // Spec 042: one food item and one training item may go together.
            if (['foodId', 'recipeId', 'mealPlanId'].filter((field) => args[field] !== undefined).length > 1) throw new BadRequestException('Attach one of a food, a recipe or a meal plan.');
            if (args['planId'] !== undefined && args['exerciseId'] !== undefined) throw new BadRequestException('Attach a plan or an exercise, not both.');
            const base = {
              requestId: (args['requestId'] as string | undefined) ?? randomUUID(),
              title: (args['title'] as string | undefined) ?? '',
              caption: String(args['caption'] ?? ''),
              audience: args['draft'] ? 'private' : 'public',
            };
            const mediaIds = (args['mediaIds'] as string[] | undefined) ?? [];
            await this.media.requireAssistantChecked(page, mediaIds);
            let dto: Record<string, unknown> = mediaIds.length ? { ...base, mediaIds } : base;
            if (args['foodId'] || args['recipeId'] || args['mealPlanId']) {
              const source = args['foodId']
                ? { kind: 'food', foodId: args['foodId'] }
                : args['recipeId']
                  ? { kind: 'combination', savedMealId: args['recipeId'] }
                  : { kind: 'mealPlan', mealPlanId: args['mealPlanId'] };
              const preview = await this.posts.preview(page, { source } as never);
              dto = { ...dto, source, previewHash: preview.previewHash };
            }
            if (args['planId'] || args['exerciseId']) {
              const training = args['planId'] ? { kind: 'plan', planId: args['planId'] } : { kind: 'exercise', exerciseId: args['exerciseId'] };
              const preview = await this.posts.previewTraining(page, training as never);
              dto = { ...dto, training, trainingHash: preview.trainingHash, allowCopy: true };
            }
            const attached = !!dto['source'] || !!dto['training'];
            if (!attached && !base.caption.trim() && !base.title.trim() && !mediaIds.length) {
              throw new BadRequestException('A post needs some text, a photo or a library item.');
            }
            const post = await this.posts.create(page, dto as never);
            return { result: { ...brief(post), draft: post.audience === 'private' }, targetId: post.id };
          }),
      },
      {
        name: 'publish_page_draft',
        description: 'Publish a draft post of the page to everyone.',
        shape: { pageId, postId: id },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const current = await this.posts.detail(page, String(args['postId']));
          if (current.author.userId !== page) throw new ForbiddenException('That is not this page’s post.');
          const updated = await this.posts.update(page, current.id, { title: current.title, caption: current.caption, audience: 'public' } as never);
          await this.record(personId, page, 'post', 'publish_page_draft', current.id);
          return brief(updated as FoodPost);
        },
      },
      {
        name: 'update_page_post',
        description: 'Change the text of a page’s post, or move it between published (draft: false) and draft (draft: true).',
        shape: { pageId, postId: id, caption: z.string().max(1000), title: z.string().max(120).optional(), draft: z.boolean().optional() },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const current = await this.posts.detail(page, String(args['postId']));
          if (current.author.userId !== page) throw new ForbiddenException('That is not this page’s post.');
          const audience = args['draft'] === undefined ? current.audience : args['draft'] ? 'private' : 'public';
          const updated = await this.posts.update(page, current.id, { title: (args['title'] as string | undefined) ?? current.title, caption: String(args['caption']), audience } as never);
          await this.record(personId, page, 'post', 'update_page_post', current.id);
          return brief(updated as FoodPost);
        },
      },
      {
        name: 'delete_page_post',
        description: 'Delete a post of the page. This cannot be undone.',
        shape: { pageId, postId: id },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const result = await this.posts.remove(page, String(args['postId']));
          await this.record(personId, page, 'post', 'delete_page_post', String(args['postId']));
          return result;
        },
      },
      {
        name: 'get_page_insights',
        description:
          'How the page is doing (spec 045): followers and new follows per day over 28 days, and for its 30 newest posts the views, likes, comments, reposts and saves. Use it to see which posts and subjects work before planning the next ones.',
        shape: { pageId },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          return this.insights.insights(page, page);
        },
      },
      {
        name: 'list_page_posts',
        description: 'A page’s own posts, newest first, drafts included.',
        shape: { pageId, cursor },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const result = await this.posts.list(page, { authorId: page, cursor: args['cursor'] as string | undefined } as never);
          return { posts: result.posts.map((post) => ({ ...brief(post), draft: post.audience === 'private' })), nextCursor: result.nextCursor };
        },
      },

      // ---- reading
      {
        name: 'get_for_you',
        description: 'The For You feed as a page sees it: public posts from people and pages who chose to be found.',
        shape: { pageId, cursor },
        run: async (personId, args) => {
          const result = await this.forYou.page(await this.acting(personId, args), { cursor: args['cursor'] as string | undefined } as never);
          return { posts: result.posts.map(brief), nextCursor: result.nextCursor };
        },
      },
      {
        name: 'get_following',
        description: 'The Following feed of a page: its own posts and the public posts of the pages it follows.',
        shape: { pageId, cursor },
        run: async (personId, args) => {
          const result = await this.posts.list(await this.acting(personId, args), { cursor: args['cursor'] as string | undefined } as never);
          return { posts: result.posts.map(brief), nextCursor: result.nextCursor };
        },
      },
      {
        name: 'get_post',
        description: 'One post, with what it carries, as the page may see it.',
        shape: { pageId, postId: id },
        run: async (personId, args) => {
          const post = await this.posts.detail(await this.acting(personId, args), String(args['postId']));
          const any = post as unknown as Record<string, unknown>;
          return { ...brief(post), items: any['items'], training: any['training'] };
        },
      },
      {
        name: 'get_post_comments',
        description: 'The comments on a post, newest first, 20 at a time. Each has replyCount and its latest reply; to answer one, use comment_on_post with replyTo.',
        shape: { pageId, postId: id, before: id.optional().describe('A comment id: answers the comments before it.') },
        run: async (personId, args) => {
          const page = await this.engagement.list(await this.acting(personId, args), String(args['postId']), args['before'] as string | undefined, 20);
          return {
            comments: page.comments.map((comment) => ({
              id: comment.id,
              author: { id: comment.author.userId, name: comment.author.displayName, isPage: comment.author.isPage === true },
              text: comment.text,
              createdAt: comment.createdAt,
              replyCount: comment.replyCount ?? 0,
              likeCount: comment.likeCount ?? 0,
              likedByPage: comment.liked === true,
              // The newest reply, so you can tell whether the page has already answered.
              ...(comment.replies?.length
                ? { latestReply: { id: comment.replies[comment.replies.length - 1].id, author: { id: comment.replies[comment.replies.length - 1].author.userId, isPage: comment.replies[comment.replies.length - 1].author.isPage === true }, text: comment.replies[comment.replies.length - 1].text } }
                : {}),
            })),
            nextCursor: page.nextCursor,
          };
        },
      },
      {
        name: 'get_account_profile',
        description: 'The profile of a page or a person, as the page may see it: name, description, whether it is a page, its follower count.',
        shape: { pageId, accountId: id },
        run: async (personId, args) => {
          const profile = await this.social.profile(await this.acting(personId, args), String(args['accountId']), utcDay());
          return {
            id: profile.userId,
            name: profile.displayName,
            username: profile.username,
            bio: profile.bio,
            isPage: profile.isPage === true,
            runWithAi: profile.aiManaged === true,
            official: profile.official === true,
            ...(profile.followerCount !== undefined ? { followers: profile.followerCount } : {}),
            ...(profile.following !== undefined ? { following: profile.following } : {}),
          };
        },
      },
      {
        name: 'get_suggested_pages',
        description: 'Pages the acting page might follow: the app’s own first, then the most followed.',
        shape: { pageId },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const ids = await this.follows.suggested(page);
          const cards = await this.social.pageCards(ids);
          return ids.flatMap((pageIdOf) => {
            const card = cards.get(pageIdOf);
            return card ? [{ id: card.userId, name: card.displayName, username: card.username, bio: card.bio, official: card.official === true }] : [];
          });
        },
      },

      // ---- engaging
      {
        name: 'follow_page',
        description: 'Follow a page or a person as the acting page: their public posts then show in get_following. The id may be a page’s or a person’s.',
        shape: { pageId, targetPageId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'follow', 'follow_page', async (page) => {
            const targetId = String(args['targetPageId']);
            return { result: await this.follows.follow(page, targetId), targetId };
          }),
      },
      {
        name: 'unfollow_page',
        description: 'Stop following a page.',
        shape: { pageId, targetPageId: id },
        run: async (personId, args) => this.follows.unfollow(await this.acting(personId, args), String(args['targetPageId'])),
      },
      {
        name: 'like_post',
        description: 'Like a post as the acting page.',
        shape: { pageId, postId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'like', 'like_post', async (page) => {
            const post = await this.posts.detail(page, String(args['postId']));
            return { result: await this.engagement.setLike(page, post.id, true), targetId: post.id };
          }),
      },
      {
        name: 'unlike_post',
        description: 'Take back a like.',
        shape: { pageId, postId: id },
        run: async (personId, args) => this.engagement.setLike(await this.acting(personId, args), String(args['postId']), false),
      },
      {
        name: 'like_comment',
        description:
          'Like a comment or reply as the acting page (ids from get_post_comments). Its author is told. Counts as a like against the daily cap. Like a comment you are glad to see, never your own.',
        shape: { pageId, postId: id, commentId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'like', 'like_comment', async (page) => ({
            result: await this.engagement.setCommentLike(page, String(args['postId']), String(args['commentId']), true),
            targetId: String(args['commentId']),
          })),
      },
      {
        name: 'unlike_comment',
        description: 'Take back a like on a comment.',
        shape: { pageId, postId: id, commentId: id },
        run: async (personId, args) => this.engagement.setCommentLike(await this.acting(personId, args), String(args['postId']), String(args['commentId']), false),
      },
      {
        name: 'repost_post',
        description: 'Repost a post as the acting page, so the page’s followers see it. Only posts the page can read; never its own.',
        shape: { pageId, postId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'like', 'repost_post', async (page) => ({
            result: await this.engagement.setRepost(page, String(args['postId']), true),
            targetId: String(args['postId']),
          })),
      },
      {
        name: 'unrepost_post',
        description: 'Take back a repost.',
        shape: { pageId, postId: id },
        run: async (personId, args) => this.engagement.setRepost(await this.acting(personId, args), String(args['postId']), false),
      },
      {
        name: 'delete_page_comment',
        description: 'Delete a comment: one the page wrote anywhere, or anyone’s comment on the page’s own post.',
        shape: { pageId, postId: id, commentId: id },
        run: async (personId, args) => this.engagement.remove(await this.acting(personId, args), String(args['postId']), String(args['commentId'])),
      },
      {
        name: 'get_page_notifications',
        description:
          'What happened to the page lately, newest first: likes, comments, replies, reposts, follows, messages. Each names the post or comment it is about, so you can answer with get_post_comments and comment_on_post (replyTo). Pass `before` (an ISO time from the last item) for older ones.',
        shape: { pageId, before: z.string().datetime().optional() },
        run: async (personId, args) =>
          this.notifications.activity(await this.acting(personId, args), args['before'] ? new Date(String(args['before'])) : undefined),
      },
      {
        name: 'block_account',
        description: 'Block a person or page from the acting page: they can no longer see, follow, comment on or message it, and any follow between them ends. For abuse and spam only.',
        shape: { pageId, accountId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'follow', 'block_account', async (page) => ({
            result: await this.social.act(page, String(args['accountId']), { action: 'block' } as never),
            targetId: String(args['accountId']),
          })),
      },
      {
        name: 'unblock_account',
        description: 'Unblock an account the acting page blocked.',
        shape: { pageId, accountId: id },
        run: async (personId, args) => this.social.act(await this.acting(personId, args), String(args['accountId']), { action: 'unblock' } as never),
      },
      {
        name: 'comment_on_post',
        description:
          'Comment on a post as the acting page. The comment is shown as the page’s, marked as run with AI.',
        shape: { pageId, postId: id, text: z.string().min(1).max(1000), replyTo: id.optional().describe('A comment id from get_post_comments, to answer that comment.'), requestId },
        run: (personId, args) =>
          this.counted(personId, args, 'comment', 'comment_on_post', async (page) => {
            const post = await this.posts.detail(page, String(args['postId']));
            const comment = await this.engagement.add(page, post.id, String(args['text']), (args['requestId'] as string | undefined) ?? randomUUID(), undefined, args['replyTo'] as string | undefined);
            return { result: comment, targetId: post.id };
          }),
      },
      {
        name: 'list_page_conversations',
        description: 'The page’s conversations: who wrote, the last message, and whether it is unread.',
        shape: { pageId },
        run: async (personId, args) => {
          const inbox = await this.messages.inbox(await this.acting(personId, args));
          return inbox.map((entry) => {
            const any = entry as unknown as Record<string, unknown>;
            return { id: entry.id, with: { id: entry.other.userId, name: entry.other.displayName, isPage: entry.other.isPage === true }, preview: any['preview'], unread: any['unread'], lastAt: any['lastAt'] };
          });
        },
      },
      {
        name: 'get_conversation_messages',
        description: 'The latest messages of one of the page’s conversations.',
        shape: { pageId, conversationId: id },
        run: async (personId, args) => {
          const page = await this.acting(personId, args);
          const result = await this.messages.page(page, String(args['conversationId']));
          return result.messages.map((message) => {
            const any = message as unknown as Record<string, unknown>;
            return { id: any['id'], fromPage: any['mine'] ?? any['senderId'] === page, text: any['text'], kind: any['kind'], createdAt: any['createdAt'] };
          });
        },
      },
      {
        name: 'reply_in_conversation',
        description:
          'Send a message as the page in an existing conversation. A page answers people who wrote to it or follow it; it cannot write first to anyone else.',
        shape: { pageId, conversationId: id, text: z.string().min(1).max(2000), requestId },
        run: (personId, args) =>
          this.counted(personId, args, 'message', 'reply_in_conversation', async (page) => {
            const conversationId = String(args['conversationId']);
            const view = await this.messages.view(page, conversationId);
            const sent = await this.messages.send(page, conversationId, { requestId: (args['requestId'] as string | undefined) ?? randomUUID(), text: String(args['text']) });
            return { result: { id: (sent as unknown as Record<string, unknown>)['id'] }, targetId: conversationId };
          }),
      },
    ];
    return tools;
  }

  /** Runs one page tool for the legacy `/mcp/call` endpoint, or answers `undefined` if it is not one. */
  async call(personId: string, name: string, args: Record<string, unknown>): Promise<{ result: unknown } | undefined> {
    const tool = this.tools().find((candidate) => candidate.name === name);
    if (!tool) return undefined;
    const parsed = z.object(tool.shape).safeParse(args);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    return { result: await tool.run(personId, parsed.data as Record<string, unknown>) };
  }
}

/** What the owner may store as caps: every kind, each a whole number, `-1` for none. */
export function parseCaps(input: unknown, partial: boolean): Record<string, number> {
  if (!input || typeof input !== 'object') throw new BadRequestException('Send the caps as an object.');
  const out: Record<string, number> = {};
  for (const kind of ASSISTANT_ACTION_KINDS) {
    const value = (input as Record<string, unknown>)[kind];
    if (value === undefined && partial) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || (value !== ASSISTANT_CAP_NONE && (value < 0 || value > ASSISTANT_CAP_MAX))) {
      throw new BadRequestException(`"${kind}" must be a whole number from 0 to ${ASSISTANT_CAP_MAX}, or ${ASSISTANT_CAP_NONE} for no limit.`);
    }
    out[kind] = value;
  }
  return out;
}

export const isId = (value: string) => isValidObjectId(value);
