import type { MealEntry } from '@life-portal/shared-types';
import { recipeGroups } from './recipe-groups';

const entry = (id: string, extra: Partial<MealEntry> = {}) => ({ id, createdAt: '2026-11-23T10:00:00.000Z', ...extra }) as MealEntry;

describe('recipeGroups (spec 044)', () => {
  it('makes one row of the foods logged together from a recipe, where the first of them was', () => {
    const items = recipeGroups([
      entry('apple'),
      entry('rice', { savedMealId: 'bowl', mealLogId: 'log1', mealServings: 2 }),
      entry('tea'),
      entry('chicken', { savedMealId: 'bowl', mealLogId: 'log1', mealServings: 2 }),
      entry('rice2', { savedMealId: 'bowl', mealLogId: 'log2' }),
    ]);
    expect(items.map((item) => (item.kind === 'entry' ? item.entry.id : `${item.id}:${item.entries.map((each) => each.id).join('+')}:${item.servings ?? ''}`))).toEqual([
      'apple',
      'log1:rice+chicken:2',
      'tea',
      'log2:rice2:',
    ]);
  });
  it('groups a recipe logged before groups existed by its recipe and minute', () => {
    const items = recipeGroups([entry('a', { savedMealId: 'bowl' }), entry('b', { savedMealId: 'bowl' }), entry('c', { savedMealId: 'bowl', createdAt: '2026-11-23T12:00:00.000Z' })]);
    expect(items.map((item) => (item.kind === 'group' ? item.entries.length : 0))).toEqual([2, 1]);
  });
});
