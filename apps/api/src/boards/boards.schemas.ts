import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ATTENTION_STATES,
  BOARD_FEATURES,
  BOARD_KINDS,
  CONTRIBUTION_TYPES,
  TASK_STATUSES,
} from '@life-portal/shared-types';
import { baseSchemaOptions, dayField, requiredDayField } from '../common/mongoose';

/**
 * Widgets 5-7 share one collection.
 *
 * "EPAM work", "client project", "SoulArt" and "ShopIt" are the same screen with different
 * names, so they are rows rather than four near-identical modules. A board opts into extra
 * sections through `features`, which is how the EPAM board gets people and Talent-Partner
 * contribution tracking while SoulArt carries no dead UI.
 */
@Schema({ ...baseSchemaOptions, collection: 'boards' })
export class Board {
  @Prop({ required: true, index: true }) userId!: string;
  /** Stable slug used in URLs and by the seed, e.g. `epam`. */
  @Prop({ required: true, trim: true, lowercase: true }) key!: string;
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ required: true, enum: BOARD_KINDS }) kind!: string;
  @Prop() description?: string;
  @Prop({ default: 'violet' }) accent!: string;
  @Prop({ type: [String], enum: BOARD_FEATURES, default: ['tasks', 'notes'] })
  features!: string[];
  @Prop({ default: 0 }) order!: number;
  @Prop({ default: false }) archived!: boolean;
}

export const BoardSchema = SchemaFactory.createForClass(Board);
BoardSchema.index({ userId: 1, key: 1 }, { unique: true });

@Schema({ ...baseSchemaOptions, collection: 'board_tasks' })
export class BoardTask {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, index: true }) boardId!: string;
  @Prop({ required: true, trim: true }) title!: string;
  @Prop() notes?: string;
  @Prop({ required: true, enum: TASK_STATUSES, default: 'todo', index: true }) status!: string;
  /** 1 = drop everything, 4 = someday. */
  @Prop({ required: true, min: 1, max: 4, default: 3 }) priority!: number;
  @Prop(dayField) dueDate?: string;
  @Prop({ type: [String], default: [] }) tags!: string[];
  /** Why it matters — drives the "what moves the needle" sort. */
  @Prop({ enum: ['promotion', 'performance_review', 'revenue', 'maintenance', 'learning'] })
  impact?: string;
  @Prop({ min: 0 }) estimateHours?: number;
  @Prop({ default: 0 }) order!: number;
  @Prop(dayField) completedAt?: string;
  @Prop() blockedReason?: string;
}

export const BoardTaskSchema = SchemaFactory.createForClass(BoardTask);
BoardTaskSchema.index({ userId: 1, boardId: 1, status: 1, priority: 1 });

@Schema({ ...baseSchemaOptions, collection: 'board_notes' })
export class BoardNote {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, index: true }) boardId!: string;
  @Prop({ required: true, trim: true }) title!: string;
  @Prop({ default: '' }) body!: string;
  @Prop({ default: false }) pinned!: boolean;
  @Prop({ type: [String], default: [] }) tags!: string[];
}

export const BoardNoteSchema = SchemaFactory.createForClass(BoardNote);

/** A direct report on the EPAM board. */
@Schema({ ...baseSchemaOptions, collection: 'board_people' })
export class Person {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, index: true }) boardId!: string;
  @Prop({ required: true, trim: true }) name!: string;
  @Prop() role?: string;
  /** EPAM grade, e.g. `A3`. */
  @Prop() level?: string;
  /** Client project they are staffed on. */
  @Prop() project?: string;
  @Prop() email?: string;
  @Prop({ required: true, enum: ATTENTION_STATES, default: 'ok', index: true })
  attentionState!: string;
  /** The "why" behind a non-ok state. */
  @Prop() attentionReason?: string;
  @Prop(dayField) nextCheckIn?: string;
  @Prop(dayField) lastOneOnOne?: string;
  /** Days between 1:1s; drives the overdue flag. */
  @Prop({ min: 1, default: 14 }) oneOnOneCadenceDays?: number;
  @Prop(dayField) nextReviewDate?: string;
  @Prop() notes?: string;
  @Prop({ default: false }) archived!: boolean;
}

export const PersonSchema = SchemaFactory.createForClass(Person);

/**
 * A perk-earning activity for the Talent Partner role. Interviews, referrals and staffing
 * help accumulate towards promotion, so they are worth counting rather than remembering.
 */
@Schema({ ...baseSchemaOptions, collection: 'board_contributions' })
export class Contribution {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, index: true }) boardId!: string;
  @Prop({ required: true, enum: CONTRIBUTION_TYPES }) type!: string;
  @Prop({ required: true, trim: true }) title!: string;
  @Prop(requiredDayField) date!: string;
  @Prop({ required: true, default: 1, min: 0 }) points!: number;
  @Prop() outcome?: string;
  @Prop() personId?: string;
  @Prop() note?: string;
}

export const ContributionSchema = SchemaFactory.createForClass(Contribution);
ContributionSchema.index({ userId: 1, boardId: 1, date: -1 });

/** Evidence for a performance review — the "show the client what I did" log. */
@Schema({ ...baseSchemaOptions, collection: 'board_wins' })
export class Win {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, index: true }) boardId!: string;
  @Prop({ required: true, trim: true }) title!: string;
  @Prop(requiredDayField) date!: string;
  /** What changed because of it, ideally with a number attached. */
  @Prop() impact?: string;
  /** Who noticed. Useful when asking for a reference later. */
  @Prop({ type: [String], default: [] }) witnesses!: string[];
  @Prop({ type: [String], default: [] }) tags!: string[];
  @Prop() note?: string;
}

export const WinSchema = SchemaFactory.createForClass(Win);
