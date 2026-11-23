import { programmeProblem } from './programmes';

describe('programmeProblem (spec 042)', () => {
  it('needs a name and at least one of the two plans', () => {
    expect(programmeProblem({ name: ' ', mealPlanId: 'm' })).toBe('Give the programme a name.');
    expect(programmeProblem({ name: 'Cut' })).toBe('Add a meal plan, a training plan, or both.');
    expect(programmeProblem({ name: 'x'.repeat(81), mealPlanId: 'm' })).toMatch(/80 characters/);
    expect(programmeProblem({ name: 'Cut', description: 'x'.repeat(501), mealPlanId: 'm' })).toBe('The description is too long.');
  });
  it('accepts one plan or both', () => {
    expect(programmeProblem({ name: 'Cut', mealPlanId: 'm' })).toBeUndefined();
    expect(programmeProblem({ name: 'Cut', trainingPlanId: 't' })).toBeUndefined();
    expect(programmeProblem({ name: 'Cut', mealPlanId: 'm', trainingPlanId: 't' })).toBeUndefined();
  });
});
