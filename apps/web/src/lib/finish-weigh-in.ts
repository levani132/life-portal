import type { RecentWeighIns } from '@life-portal/shared-types';

type Row = RecentWeighIns['weighIns'][number];

/**
 * The finish sheet's one body-weight field (issue #25), decided without the DOM.
 *
 * - With a weigh-in **today**, the field shows it. Saving writes only if the number was changed,
 *   and that is labelled as replacing today's measurement.
 * - Without one, the field is prefilled from the latest weigh-in, and nothing is saved unless the
 *   person ticks "Save as today's weigh-in" (or edits the number, which ticks it).
 * - Finishing or confirming alone never writes a weigh-in.
 */
export interface WeighInField {
  /** The weigh-in already recorded today, if any. */
  today?: Row;
  /** What the field starts with: today's, else the latest, else empty. */
  prefill?: Row;
}

export function weighInField(rows: readonly Row[] | undefined, day: string): WeighInField {
  const today = rows?.find((row) => row.day === day);
  const prefill = today ?? rows?.[0];
  return { ...(today ? { today } : {}), ...(prefill ? { prefill } : {}) };
}

/** What confirming the sheet does with the field: nothing, or one write of these grams. */
export function weighInWrite(
  field: WeighInField,
  enteredGrams: number | undefined,
  save: boolean,
): { weightGrams: number; replaces?: number } | undefined {
  if (enteredGrams === undefined || !Number.isInteger(enteredGrams) || enteredGrams < 20_000 || enteredGrams > 400_000) return undefined;
  if (field.today) {
    // An unchanged prefilled value is not a new measurement.
    return enteredGrams === field.today.weightGrams ? undefined : { weightGrams: enteredGrams, replaces: field.today.weightGrams };
  }
  return save ? { weightGrams: enteredGrams } : undefined;
}
