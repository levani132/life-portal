import { RECIPE_LIMITS } from '@life-portal/shared-types';

/**
 * Spec 044: the amounts to log for some servings of a recipe that makes `makes` servings. Each food
 * is scaled by servings ÷ makes and rounded to a whole gram or millilitre, never below one. The
 * server and the device (logging offline) use this one rule, so both log the same amounts.
 */
export function recipePortion<C extends { amount: number }>(components: readonly C[], makes: number | undefined, servings: number): C[] {
  const factor = servings / Math.max(1, makes ?? 1);
  return components.map((component) => ({ ...component, amount: Math.max(1, Math.round(component.amount * factor)) }));
}

/** Why a number of servings cannot be logged, or nothing when it can: up to 20, in quarters. */
export function servingsProblem(servings: number): string | undefined {
  if (!Number.isFinite(servings) || servings <= 0) return 'Log at least a quarter of a serving.';
  if (servings > RECIPE_LIMITS.logServingsMax) return `At most ${RECIPE_LIMITS.logServingsMax} servings at once.`;
  if (Math.round(servings * 4) !== servings * 4) return 'Servings go in quarters: ¼, ½, ¾, 1, 1¼…';
  return undefined;
}

/** "½", "1", "1½", "2¼": servings as people say them. */
export function servingsText(servings: number): string {
  const whole = Math.floor(servings);
  const quarter = Math.round((servings - whole) * 4);
  const part = ['', '¼', '½', '¾'][quarter] ?? '';
  return whole === 0 ? part || '0' : `${whole}${part}`;
}
