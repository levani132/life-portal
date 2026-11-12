import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  BADGE_CATALOGUE,
  type BadgeDefinition,
  type BadgeFamily,
  type BadgeId,
  type BadgeView,
  type FeatureAccess,
  type MyBadges,
  type PersonBadges,
  type PublicBadge,
} from '@life-portal/shared-types';
import { evaluateBadges, type BadgeEvaluation } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { User } from '../auth/schemas/user.schema';
import { NutritionService } from '../nutrition/nutrition.service';
import { PortalService } from '../portal/portal.module';
import { PostsService } from '../posts/posts.service';
import { SocialGraphService } from '../social-graph/social-graph.module';
import { BadgeAward, BadgeSelection } from './badges.schemas';

type AwardRow = Pick<BadgeAward, 'badgeId' | 'tier' | 'earnedOn'>;

/** Families with rules today. Training is listed in the catalogue but evaluated from US4 on. */
const EVALUATED: BadgeFamily[] = ['standard', 'food'];

export function accessible(def: BadgeDefinition, access: FeatureAccess): boolean {
  return def.requires.every((flag) => access[flag]);
}

/**
 * Profile badges (spec 022, docs/modules/badges.md). Evaluates the catalogue from facts other
 * modules export, stores only awards and equip choices, and never queries another module's
 * collections.
 */
@Injectable()
export class BadgesService {
  constructor(
    @InjectModel(BadgeAward.name) private readonly awards: Model<BadgeAward>,
    @InjectModel(BadgeSelection.name)
    private readonly selections: Model<BadgeSelection>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly access: AccessService,
    private readonly nutrition: NutritionService,
    private readonly posts: PostsService,
    private readonly portal: PortalService,
    private readonly graph: SocialGraphService,
  ) {}

  /**
   * Inserts an award if it does not exist. `true` only for the call that created it, so two
   * concurrent evaluations award (and later notify) once. `$setOnInsert` only: the filter fields
   * are copied into the new row by the upsert itself.
   */
  async award(userId: string, badgeId: BadgeId, tier: number, earnedOn: string): Promise<boolean> {
    try {
      const result = await this.awards.updateOne(
        { userId, badgeId, tier },
        { $setOnInsert: { earnedOn, source: 'rule' } },
        { upsert: true },
      );
      return result.upsertedCount === 1;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }

  /**
   * Evaluates every rule and awards what history now reaches. A family whose every tier is
   * already awarded is not loaded. Inaccessible badges are still awarded (research R10), so
   * nothing is lost while a feature is off.
   */
  async evaluate(
    userId: string,
    today: string,
  ): Promise<{ awards: AwardRow[]; created: AwardRow[]; evaluations: BadgeEvaluation[] }> {
    const [existing, user] = await Promise.all([
      this.awards.find({ userId }).select('badgeId tier earnedOn').lean<AwardRow[]>(),
      this.users.findById(userId).select('createdAt').lean<{ createdAt?: Date }>(),
    ]);
    if (!user) throw new UnauthorizedException('Account not found.');
    const has = (id: BadgeId, tier: number) =>
      existing.some((row) => row.badgeId === id && row.tier === tier);
    const done = (ids: BadgeId[]) =>
      ids.every((id) =>
        (BADGE_CATALOGUE.find((def) => def.id === id)?.tiers ?? []).every((tier) => has(id, tier)),
      );
    const familyDone = (family: BadgeFamily) =>
      done(BADGE_CATALOGUE.filter((def) => def.family === family).map((def) => def.id));

    const [setupCompleted, postDays, friendAcceptedDays, food] = await Promise.all([
      has('setup', 1) ? true : this.portal.get(userId).then((state) => state.setupCompleted),
      has('firstPost', 1) ? [] : this.posts.originalPostDays(userId),
      done(['firstFriend', 'connected']) ? [] : this.graph.acceptedSince(userId),
      familyDone('food') ? undefined : this.nutrition.badgeInputs(userId, today),
    ]);
    const accountCreatedOn = (user.createdAt ?? new Date()).toISOString().slice(0, 10);
    const evaluations = evaluateBadges(
      { accountCreatedOn, setupCompleted, postDays, friendAcceptedDays, food },
      today,
    );

    const created: AwardRow[] = [];
    for (const evaluation of evaluations) {
      for (const { tier, reachedOn } of evaluation.reached) {
        if (has(evaluation.badgeId, tier)) continue;
        if (await this.award(userId, evaluation.badgeId, tier, reachedOn)) {
          created.push({ badgeId: evaluation.badgeId, tier, earnedOn: reachedOn });
        }
      }
    }
    return { awards: [...existing, ...created], created, evaluations };
  }

  /** The owner's collection: evaluates, then shows only what the owner can access. */
  async mine(userId: string, today: string): Promise<MyBadges> {
    await this.access.require(userId, 'social');
    const [{ awards, created, evaluations }, { access }, selection] = await Promise.all([
      this.evaluate(userId, today),
      this.access.forUser(userId),
      this.selections.findOne({ userId }).lean(),
    ]);
    const badges = BADGE_CATALOGUE.filter(
      (def) => EVALUATED.includes(def.family) && accessible(def, access),
    ).map(
      (def): BadgeView => {
        const tiersEarned = awards
          .filter((row) => row.badgeId === def.id)
          .sort((a, b) => a.tier - b.tier)
          .map(({ tier, earnedOn }) => ({ tier, earnedOn }));
        const top = tiersEarned[tiersEarned.length - 1];
        const progress = evaluations.find((row) => row.badgeId === def.id)?.progress;
        const next = def.tiers.find((tier) => !tiersEarned.some((row) => row.tier === tier));
        return {
          badgeId: def.id,
          ...(top ? { tier: top.tier, earnedOn: top.earnedOn } : {}),
          tiersEarned,
          ...(progress && next != null ? { progress: { current: progress.current, next } } : {}),
          ...(created.some((row) => row.badgeId === def.id) ? { isNew: true } : {}),
        };
      },
    );
    const shown = new Set(badges.filter((badge) => badge.tier != null).map((b) => b.badgeId));
    return {
      badges,
      equipped: (selection?.equipped ?? []).filter((id): id is BadgeId =>
        shown.has(id as BadgeId),
      ),
    };
  }

  /** The trigger the web fires after qualifying actions. Awards even while a feature is off. */
  async check(userId: string, today: string): Promise<{ newBadgeIds: BadgeId[] }> {
    const { created } = await this.evaluate(userId, today);
    return { newBadgeIds: [...new Set(created.map((row) => row.badgeId as BadgeId))] };
  }

  /**
   * Replaces the equipped list (US2). Every id must be earned and accessible now; the DTO has
   * already checked the count, uniqueness and that each id is in the catalogue.
   */
  async equip(userId: string, badgeIds: BadgeId[]): Promise<{ equipped: BadgeId[] }> {
    await this.access.require(userId, 'social');
    const [{ access }, earned] = await Promise.all([
      this.access.forUser(userId),
      this.awards.distinct('badgeId', { userId, badgeId: { $in: badgeIds } }),
    ]);
    const refused = badgeIds.filter((id) => {
      const def = BADGE_CATALOGUE.find((badge) => badge.id === id);
      return !def || !accessible(def, access) || !earned.includes(id);
    });
    if (refused.length) {
      throw new BadRequestException({
        code: 'BADGE_NOT_EARNED',
        message: 'Only badges you have earned can be shown on your profile.',
        badgeIds: refused,
      });
    }
    await this.selections.updateOne(
      { userId },
      { $set: { equipped: badgeIds } },
      { upsert: true },
    );
    return { equipped: badgeIds };
  }

  /**
   * What anyone who may see a profile sees (US3): the equipped badges, each at its highest tier,
   * and nothing else. The gate mirrors `SocialService.profile`: the viewer has `social`, the
   * target exists and has `social`, and neither has blocked the other; otherwise 404, so the
   * answer never says whether the person exists. No evaluation runs here.
   */
  async forPerson(viewerId: string, targetId: string): Promise<PersonBadges> {
    const missing = () => new NotFoundException('Profile not found.');
    if (!isValidObjectId(targetId)) throw missing();
    await this.access.require(viewerId, 'social');
    if (viewerId !== targetId && (await this.graph.isBlocked(viewerId, targetId))) throw missing();
    let target: FeatureAccess;
    try {
      target = (await this.access.forUser(targetId)).access;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw missing();
      throw error;
    }
    if (!target.social) throw missing();
    const selection = await this.selections.findOne({ userId: targetId }).lean();
    const ids = selection?.equipped ?? [];
    if (!ids.length) return { equipped: [] };
    const awards = await this.awards
      .find({ userId: targetId, badgeId: { $in: ids } })
      .select('badgeId tier earnedOn')
      .lean<AwardRow[]>();
    const equipped = ids.flatMap((id): PublicBadge[] => {
      const def = BADGE_CATALOGUE.find((badge) => badge.id === id);
      const top = awards
        .filter((row) => row.badgeId === id)
        .sort((a, b) => b.tier - a.tier)[0];
      if (!def || !top || !accessible(def, target)) return [];
      return [{ badgeId: def.id, tier: top.tier, earnedOn: top.earnedOn }];
    });
    return { equipped };
  }
}
