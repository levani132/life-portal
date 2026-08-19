import type { Db } from 'mongodb';
import { factsFromInput } from '@life-portal/shared-domain';
import { upsert } from './upsert';

/**
 * The owner's starting food database, transcribed from the tracker they used before this widget.
 *
 * Three transcription decisions, so the numbers can be audited later:
 *
 * 1. **Values are per serving, as the source stated them**, and are normalised to per-100 by the
 *    same `factsFromInput` the API uses for a hand-entered food — no second implementation of the
 *    conversion.
 * 2. **An egg is taken as 50 g.** The source measured eggs in "1 egg" with no weight, and this
 *    app stores amounts in grams. 50 g is a large egg, and it reproduces the source's own figures
 *    (72 kcal per egg is 143 kcal/100 g, which is exactly boiled egg). Change `servingSize` if the
 *    eggs in question are bigger.
 * 3. **Where the source showed 0 for *every* one of trans fat, saturated fat and fibre, those
 *    fields are treated as not recorded** and left absent rather than stored as zero — that
 *    pattern is an unfilled form, not a claim about the food. Where any of them had a real value,
 *    all of them are taken at face value, including honest zeros (grilled chicken really has no
 *    fibre). This is why `fibreMg` is set on some rows and absent on others.
 *
 * Trans fat has no field in this module: every reading here was 0 except one at 0.1 g, which is
 * not worth a column. Add one if that ever changes.
 */
export interface SeedFood {
  name: string;
  brand?: string;
  unit: 'g' | 'ml';
  /** Base units in one serving, as the numbers below are stated. */
  servingSize: number;
  servingLabel?: string;
  favourite?: boolean;
  /** Per serving. */
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  satFatG?: number;
  fibreG?: number;
}

export const SEED_FOODS: SeedFood[] = [
  // ---- Fresco ready meals
  {
    name: 'Chicken Kebab with Lavash',
    brand: 'Fresco',
    unit: 'g',
    servingSize: 100,
    energyKcal: 237,
    proteinG: 22.2,
    carbG: 25.8,
    fatG: 4.8,
  },
  {
    name: 'Chicken Kebab',
    brand: 'Fresco',
    unit: 'g',
    servingSize: 100,
    energyKcal: 180,
    proteinG: 20.25,
    carbG: 13.37,
    fatG: 4.61,
  },
  {
    name: 'Chicken cutlet',
    brand: 'Fresco',
    unit: 'g',
    servingSize: 100,
    energyKcal: 232,
    proteinG: 18,
    carbG: 13,
    fatG: 12,
    satFatG: 2.5,
    fibreG: 0.8,
  },
  {
    name: 'Chicken Nuggets',
    brand: 'Fresco',
    unit: 'g',
    servingSize: 100,
    energyKcal: 201,
    proteinG: 17.72,
    carbG: 0.89,
    fatG: 13.52,
  },

  // ---- shakes and bars
  {
    name: 'Protein Shake',
    brand: 'LA - Leko & Ana',
    unit: 'g',
    servingSize: 100,
    favourite: true,
    energyKcal: 103,
    proteinG: 11,
    carbG: 9.8,
    fatG: 1.7,
  },
  {
    name: 'Protein Shake (Without Greek Yogurt)',
    brand: 'LA - Leko & Ana',
    unit: 'g',
    servingSize: 100,
    energyKcal: 122,
    proteinG: 12,
    carbG: 11.7,
    fatG: 2.4,
  },
  {
    name: 'Protein Bar',
    brand: 'Go On Nutrition',
    unit: 'g',
    servingSize: 50,
    servingLabel: '1 bar',
    favourite: true,
    energyKcal: 193,
    proteinG: 16.5,
    carbG: 11.5,
    fatG: 9,
    satFatG: 4.7,
    fibreG: 6.5,
  },

  // ---- staples
  {
    name: 'Chicken Breast, Grilled Without Sauce, Skin Not Eaten',
    unit: 'g',
    servingSize: 100,
    favourite: true,
    energyKcal: 176,
    proteinG: 29.62,
    carbG: 0,
    fatG: 5.45,
    satFatG: 1.01,
    fibreG: 0,
  },
  {
    name: 'Buckwheat Groats, Roasted, Cooked',
    unit: 'g',
    servingSize: 100,
    favourite: true,
    energyKcal: 92,
    proteinG: 3.38,
    carbG: 19.9,
    fatG: 0.62,
    satFatG: 0.14,
    fibreG: 2.7,
  },
  {
    name: 'Egg, Whole, Boiled Or Poached',
    unit: 'g',
    servingSize: 50,
    servingLabel: '1 egg',
    favourite: true,
    energyKcal: 72,
    proteinG: 6.2,
    carbG: 0.48,
    fatG: 4.98,
    satFatG: 1.6,
    fibreG: 0,
  },
  {
    name: 'Egg Omelet Or Scrambled Egg, Made With Cooking Spray',
    unit: 'g',
    servingSize: 50,
    servingLabel: '1 egg',
    energyKcal: 75,
    proteinG: 6.12,
    carbG: 0.57,
    fatG: 5.3,
    satFatG: 1.6,
    fibreG: 0,
  },
];

/**
 * Writes the list above, keyed on name + brand so re-running it corrects the numbers rather than
 * duplicating the row. Returns how many rows the database now holds for this owner.
 */
export async function seedFoods(db: Db, userId: string): Promise<number> {
  for (const food of SEED_FOODS) {
    const facts = factsFromInput(
      {
        energyKcal: food.energyKcal,
        proteinMg: Math.round(food.proteinG * 1000),
        fatMg: Math.round(food.fatG * 1000),
        carbMg: Math.round(food.carbG * 1000),
        ...(food.satFatG != null ? { satFatMg: Math.round(food.satFatG * 1000) } : {}),
        ...(food.fibreG != null ? { fibreMg: Math.round(food.fibreG * 1000) } : {}),
      },
      'per_serving',
      food.servingSize,
    );

    await upsert(
      db.collection('foods'),
      { userId, name: food.name, brand: food.brand ?? null },
      {
        userId,
        name: food.name,
        // Stored as `null` rather than omitted, so the natural key matches on re-run.
        brand: food.brand ?? null,
        unit: food.unit,
        servingSize: food.servingSize,
        ...(food.servingLabel ? { servingLabel: food.servingLabel } : {}),
        entryMode: 'per_serving',
        favourite: food.favourite ?? false,
        source: 'manual',
        archived: false,
        ...facts,
      },
    );
  }
  return db.collection('foods').countDocuments({ userId });
}
