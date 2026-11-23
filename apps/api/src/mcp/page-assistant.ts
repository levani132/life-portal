import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  ASSISTANT_ACTION_KINDS,
  ASSISTANT_CAP_MAX,
  ASSISTANT_CAP_NONE,
  EQUIPMENT_TYPES,
  MEASURES,
  MUSCLES,
  PLAN_TARGET_TYPES,
  type AssistantActionKind,
  type AssistantActivity,
  type AssistantCaps,
  type FoodPost,
} from '@life-portal/shared-types';
import { assistantCap, assistantDefaults, underAssistantCap } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { FollowsService } from '../follows/follows.module';
import { MessagesService } from '../messages/messages.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { PagesService } from '../pages/pages.module';
import { ForYouService } from '../posts/for-you.service';
import { PostEngagementService } from '../posts/post-engagement.service';
import { PostsService } from '../posts/posts.service';
import { SocialService } from '../social/social.module';
import { CatalogueService } from '../training/catalogue.service';
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
    };
  }

  // ------------------------------------------------------------------ the tools

  tools(): AssistantTool[] {
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
          }));
        },
      },
      {
        name: 'create_page_recipe',
        description: 'Create a recipe from foods already in the page’s library. Amounts are in each food’s own unit (g or ml).',
        shape: {
          pageId,
          name: z.string().min(1).max(120),
          foods: z.array(z.object({ foodId: id, amount: z.number().int().min(1).max(10_000) })).min(1).max(20),
        },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'create_page_recipe', async (page) => {
            const created = await this.nutrition.createSavedMeal(page, { name: String(args['name']), components: args['foods'] } as never);
            return { result: { id: created.id, name: created.name, totals: created.totals }, targetId: created.id };
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
        name: 'delete_page_plan',
        description: 'Remove a training plan from a page’s library.',
        shape: { pageId, planId: id },
        run: (personId, args) =>
          this.counted(personId, args, 'library', 'delete_page_plan', async (page) => ({
            result: await this.plans.remove(page, String(args['planId'])),
            targetId: String(args['planId']),
          })),
      },

      // ---- posts
      {
        name: 'create_page_post',
        description:
          'Publish a post as a page, or save it as a draft (draft: true) that only the page’s managers see until it is published. A post is text, and may carry one item from the page’s library for people to save or copy: a food, a recipe, a training plan or an exercise. Present library content as something to save, never as something the page ate or did.',
        shape: {
          pageId,
          caption: z.string().max(1000),
          title: z.string().max(120).optional(),
          draft: z.boolean().optional(),
          foodId: id.optional(),
          recipeId: id.optional(),
          planId: id.optional(),
          exerciseId: id.optional(),
          requestId,
        },
        run: (personId, args) =>
          this.counted(personId, args, 'post', 'create_page_post', async (page) => {
            const attached = ['foodId', 'recipeId', 'planId', 'exerciseId'].filter((key) => args[key] !== undefined);
            if (attached.length > 1) throw new BadRequestException('Attach one library item at most.');
            const base = {
              requestId: (args['requestId'] as string | undefined) ?? randomUUID(),
              title: (args['title'] as string | undefined) ?? '',
              caption: String(args['caption'] ?? ''),
              audience: args['draft'] ? 'private' : 'public',
            };
            let dto: Record<string, unknown> = base;
            if (args['foodId'] || args['recipeId']) {
              const source = args['foodId'] ? { kind: 'food', foodId: args['foodId'] } : { kind: 'combination', savedMealId: args['recipeId'] };
              const preview = await this.posts.preview(page, { source } as never);
              dto = { ...base, source, previewHash: preview.previewHash };
            } else if (args['planId'] || args['exerciseId']) {
              const training = args['planId'] ? { kind: 'plan', planId: args['planId'] } : { kind: 'exercise', exerciseId: args['exerciseId'] };
              const preview = await this.posts.previewTraining(page, training as never);
              dto = { ...base, training, trainingHash: preview.trainingHash, allowCopy: true };
            } else if (!base.caption.trim() && !base.title.trim()) {
              throw new BadRequestException('A post needs some text or a library item.');
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
        description: 'The comments on a post.',
        shape: { pageId, postId: id, before: id.optional().describe('A comment id: answers the comments before it.') },
        run: async (personId, args) => {
          const page = await this.engagement.list(await this.acting(personId, args), String(args['postId']), args['before'] as string | undefined);
          return {
            comments: page.comments.map((comment) => ({
              id: comment.id,
              author: { id: comment.author.userId, name: comment.author.displayName, isPage: comment.author.isPage === true },
              text: comment.text,
              createdAt: comment.createdAt,
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
        description: 'Follow a page as the acting page.',
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
        name: 'comment_on_post',
        description:
          'Comment on a post as the acting page. The comment is shown as the page’s, marked as run with AI.',
        shape: { pageId, postId: id, text: z.string().min(1).max(1000), requestId },
        run: (personId, args) =>
          this.counted(personId, args, 'comment', 'comment_on_post', async (page) => {
            const post = await this.posts.detail(page, String(args['postId']));
            const comment = await this.engagement.add(page, post.id, String(args['text']), (args['requestId'] as string | undefined) ?? randomUUID());
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
