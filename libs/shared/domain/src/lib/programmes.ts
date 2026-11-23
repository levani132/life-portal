import { PROGRAMME_LIMITS, type ProgrammeInput } from '@life-portal/shared-types';

/** Why a programme cannot be saved as sent, or nothing when it can (spec 042). */
export function programmeProblem(input: ProgrammeInput): string | undefined {
  const name = input.name.trim();
  if (!name) return 'Give the programme a name.';
  if (name.length > PROGRAMME_LIMITS.name) return `A programme's name can be ${PROGRAMME_LIMITS.name} characters at most.`;
  if ((input.description ?? '').length > PROGRAMME_LIMITS.description) return 'The description is too long.';
  if (!input.mealPlanId && !input.trainingPlanId) return 'Add a meal plan, a training plan, or both.';
  return undefined;
}
