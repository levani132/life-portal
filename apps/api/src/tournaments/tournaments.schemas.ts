import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { TOURNAMENT_CATEGORIES } from '@life-portal/shared-types';
import { baseSchemaOptions } from '../common/mongoose';

/**
 * Monthly strength tournaments (#12). Every row expires on its own (`expireAt`, a TTL index):
 * entries, groups and locks are deleted 12 months after the season's results are final, so
 * nothing is kept longer than the retention shown before joining.
 *
 * The lock fields are a **snapshot** of the member's rank and scoring baseline when enrolment
 * closed, and a group's `results` a snapshot of its scores when grace ended. Like
 * `meal_entries.facts`, they are copied rather than derived, so a later edit or a benchmark change
 * never reshuffles a season in progress or rewrites a finished one (docs/modules/tournaments.md).
 * They are never accepted from a request.
 */
@Schema({ ...baseSchemaOptions, collection: 'tournament_entries' })
export class TournamentEntryRecord {
  @Prop({ required: true }) userId!: string;
  @Prop({ required: true }) exerciseId!: string;
  /** `YYYY-MM`. */
  @Prop({ required: true }) season!: string;
  @Prop({ required: true, enum: TOURNAMENT_CATEGORIES }) category!: string;
  /** The disclosure the member agreed to (`TOURNAMENT_CONSENT_VERSION`). */
  @Prop({ required: true }) consentVersion!: number;
  /** Set at the lock: what came of the entry. Absent before it. */
  @Prop({ enum: ['grouped', 'no_tournament', 'not_ranked'] }) outcome?: string;
  @Prop() groupId?: string;
  /** The rank at the lock: milestone 0–23 (it chose the group), its rank score and the benchmark version. */
  @Prop() lockedMilestone?: number;
  @Prop() lockedScore?: number;
  @Prop() lockedVersion?: string;
  /**
   * The scoring baseline, frozen at the lock: the best valid strength score (no work-capacity
   * bonus) of the 90 days before, from sets saved before the lock. A later edit or deletion of
   * those sets never moves it.
   */
  @Prop() lockedBaseline?: number;
  /** Developer voiding: the member sees the reason; the rest of the group no longer sees them. */
  @Prop({ type: Date }) voidedAt?: Date;
  @Prop({ maxlength: 300 }) voidReason?: string;
  @Prop({ type: Date, required: true }) expireAt!: Date;
}
export const TournamentEntrySchema = SchemaFactory.createForClass(TournamentEntryRecord);
TournamentEntrySchema.index({ userId: 1, exerciseId: 1, season: 1 }, { unique: true });
TournamentEntrySchema.index({ season: 1, exerciseId: 1, category: 1 });
TournamentEntrySchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

/** One group of 3–100 entrants, formed once at the lock. Members leave by withdrawing or voiding. */
@Schema({ ...baseSchemaOptions, collection: 'tournament_groups' })
export class TournamentGroupRecord {
  @Prop({ required: true }) season!: string;
  @Prop({ required: true }) exerciseId!: string;
  @Prop({ required: true, enum: TOURNAMENT_CATEGORIES }) category!: string;
  @Prop({ required: true }) index!: number;
  @Prop({ required: true }) minMilestone!: number;
  @Prop({ required: true }) maxMilestone!: number;
  @Prop({ type: [String], required: true }) memberIds!: string[];
  /**
   * Set once grace ends: each member's score as it stood then, frozen. Places are derived on read
   * from these scores and the members still in the group, so a withdrawal still takes effect.
   */
  @Prop({ type: Date }) finalizedAt?: Date;
  @Prop({ type: [{ _id: false, userId: String, score: Number, strengthScore: Number, baseline: Number, improvementBp: Number, bonusBp: Number, bonusWithheld: String, day: String }] })
  results?: FrozenResult[];
  @Prop({ type: Date, required: true }) expireAt!: Date;
}
export interface FrozenResult {
  userId: string;
  /** Absent with no valid set in the season. */
  score?: number;
  strengthScore?: number;
  baseline?: number;
  improvementBp?: number;
  bonusBp?: number;
  bonusWithheld?: string;
  day?: string;
}
export const TournamentGroupSchema = SchemaFactory.createForClass(TournamentGroupRecord);
TournamentGroupSchema.index({ season: 1, exerciseId: 1, category: 1, index: 1 }, { unique: true });
TournamentGroupSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Who is forming one exercise-and-category's groups for a season. Unique, so two requests or a
 * request and the hourly job never form groups twice; `formedAt` marks it done. A claim older
 * than two minutes without `formedAt` is taken over (the process died mid-way).
 */
@Schema({ ...baseSchemaOptions, collection: 'tournament_locks' })
export class TournamentLockRecord {
  @Prop({ required: true }) season!: string;
  @Prop({ required: true }) exerciseId!: string;
  @Prop({ required: true, enum: TOURNAMENT_CATEGORIES }) category!: string;
  @Prop({ type: Date, required: true }) claimedAt!: Date;
  @Prop({ type: Date }) formedAt?: Date;
  @Prop({ type: Date, required: true }) expireAt!: Date;
}
export const TournamentLockSchema = SchemaFactory.createForClass(TournamentLockRecord);
TournamentLockSchema.index({ season: 1, exerciseId: 1, category: 1 }, { unique: true });
TournamentLockSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
