import type { SchemaOptions } from 'mongoose';

/**
 * Shared schema conventions.
 *
 * Two decisions worth knowing about:
 *
 * 1. **Calendar dates are stored as `YYYY-MM-DD` strings, not `Date`.** Every date in this
 *    app is a calendar day (a salary lands "on the 7th", not "at 00:00 UTC on the 7th").
 *    Strings remove every timezone question, sort correctly in Mongo range queries, and
 *    match `libs/shared/domain` which works on day strings throughout. Only the automatic
 *    `createdAt`/`updatedAt` timestamps are real `Date`s.
 *
 * 2. **`_id` is exposed as `id`.** The shared types use `id`, so the transform renames it and
 *    strips `__v` on the way out. Nothing outside this file should touch `_id`.
 */
export const baseSchemaOptions: SchemaOptions = {
  timestamps: true,
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret['id'] = String(ret['_id']);
      delete ret['_id'];
      const createdAt = ret['createdAt'];
      const updatedAt = ret['updatedAt'];
      if (createdAt instanceof Date) ret['createdAt'] = createdAt.toISOString();
      if (updatedAt instanceof Date) ret['updatedAt'] = updatedAt.toISOString();
      return ret;
    },
  },
};

/** `YYYY-MM-DD`. Applied to every stored calendar date so bad input never reaches Mongo. */
export const DAY_STRING_MATCH: [RegExp, string] = [
  /^\d{4}-\d{2}-\d{2}$/,
  'Must be a calendar date in YYYY-MM-DD form',
];

/** Mongoose field definition for an optional calendar day. */
export const dayField = { type: String, match: DAY_STRING_MATCH } as const;

/** Mongoose field definition for a required calendar day. */
export const requiredDayField = { type: String, required: true, match: DAY_STRING_MATCH } as const;

/**
 * Optional integer-cent field. Rejects fractional cents at the schema boundary (principle II).
 *
 * Deliberately **no `default: 0`**. "Not set" and "zero" are different facts and conflating them
 * breaks every `??` fallback downstream. Two real bugs this caused before the default was
 * removed:
 *
 * - A `StockTarget` with no price stored `targetPriceCents: 0`, so
 *   `target.targetPriceCents ?? suggestedTarget.value` resolved to `0` and silently discarded
 *   the suggested target, zeroing every "value at target" figure.
 * - A `SellableItem` with no walk-away price stored `minPriceCents: 0`, so
 *   `minPriceCents ?? expectedPriceCents` made the pessimistic proceeds zero instead of falling
 *   back to the realistic price.
 *
 * Use `requiredCentsField` when the value must exist.
 */
export const centsField = {
  type: Number,
  validate: {
    validator: (value: unknown) => value == null || Number.isInteger(value),
    message: 'Monetary amounts must be an integer number of cents',
  },
} as const;

export const requiredCentsField = {
  type: Number,
  required: true,
  default: 0,
  validate: {
    validator: Number.isInteger,
    message: 'Monetary amounts must be an integer number of cents',
  },
} as const;
