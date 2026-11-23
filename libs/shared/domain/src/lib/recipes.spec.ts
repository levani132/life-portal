import { recipePortion, servingsProblem, servingsText } from './recipes';

describe('recipes (spec 044)', () => {
  const pot = [{ foodId: 'lentils', amount: 400 }, { foodId: 'oil', amount: 30 }, { foodId: 'salt', amount: 2 }];
  it('scales each food to the servings logged, never below one', () => {
    expect(recipePortion(pot, 4, 1).map((each) => each.amount)).toEqual([100, 8, 1]);
    expect(recipePortion(pot, 4, 1.5).map((each) => each.amount)).toEqual([150, 11, 1]);
    // A recipe with no servings set makes one: logging one is the whole thing, as before.
    expect(recipePortion(pot, undefined, 1).map((each) => each.amount)).toEqual([400, 30, 2]);
    expect(recipePortion(pot, undefined, 0.5)[0]).toEqual({ foodId: 'lentils', amount: 200 });
  });
  it('takes servings in quarters, up to twenty', () => {
    expect([0.25, 1, 2.75, 20].map(servingsProblem)).toEqual([undefined, undefined, undefined, undefined]);
    expect(servingsProblem(0)).toMatch(/quarter/);
    expect(servingsProblem(0.3)).toMatch(/quarters/);
    expect(servingsProblem(21)).toMatch(/20/);
  });
  it('says servings as people do', () => {
    expect([0.25, 0.5, 1, 1.5, 2.75].map(servingsText)).toEqual(['¼', '½', '1', '1½', '2¾']);
  });
});
