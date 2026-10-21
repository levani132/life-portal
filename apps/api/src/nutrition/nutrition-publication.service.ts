import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import {
  MAX_POST_ITEMS,
  type FoodAttribution,
  type FoodPublication,
  type PostImportPreview,
  type PostImportResult,
  type PostSelection,
  type PublishedFood,
} from '@life-portal/shared-types';
import {
  publicationFoodIdentity,
  validPostSelection,
  toDay,
} from '@life-portal/shared-domain';
import { Food, MealEntry, SavedMeal } from './nutrition.schemas';

type FactsSource = Pick<
  PublishedFood,
  | 'name'
  | 'brand'
  | 'servingSize'
  | 'energyKcalPer100'
  | 'proteinMgPer100'
  | 'carbMgPer100'
  | 'fatMgPer100'
  | 'fibreMgPer100'
  | 'sugarMgPer100'
  | 'satFatMgPer100'
  | 'sodiumMgPer100'
>;
@Injectable()
export class NutritionPublicationService {
  constructor(
    @InjectModel(Food.name) private readonly foods: Model<Food>,
    @InjectModel(MealEntry.name) private readonly entries: Model<MealEntry>,
    @InjectModel(SavedMeal.name) private readonly meals: Model<SavedMeal>,
  ) {}
  private attribution(food: Food): FoodAttribution | undefined {
    if (food.attribution)
      return {
        label: food.attribution.label,
        ...(food.attribution.url ? { url: food.attribution.url } : {}),
      };
    if (
      food.source === 'openfoodfacts' &&
      food.sourceRef &&
      /^\d{5,20}$/.test(food.sourceRef)
    )
      return {
        label: 'Open Food Facts · ODbL',
        url: `https://world.openfoodfacts.org/product/${food.sourceRef}`,
      };
    return undefined;
  }
  private item(f: FactsSource, unit: string, key: string): PublishedFood {
    return {
      key,
      name: f.name,
      ...(f.brand ? { brand: f.brand } : {}),
      unit: unit as PublishedFood['unit'],
      servingSize: f.servingSize,
      energyKcalPer100: f.energyKcalPer100,
      proteinMgPer100: f.proteinMgPer100,
      carbMgPer100: f.carbMgPer100,
      fatMgPer100: f.fatMgPer100,
      ...Object.fromEntries(
        (
          [
            'fibreMgPer100',
            'sugarMgPer100',
            'satFatMgPer100',
            'sodiumMgPer100',
          ] as const
        )
          .filter((key) => f[key] !== undefined)
          .map((key) => [key, f[key]]),
      ),
    };
  }
  private fromFood(food: Food, key: string, amount?: number): PublishedFood {
    const attribution = this.attribution(food);
    return {
      ...this.item(food, food.unit, key),
      ...(food.servingLabel ? { servingLabel: food.servingLabel } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(attribution ? { attribution } : {}),
    };
  }
  async snapshot(
    userId: string,
    source: PostSelection,
  ): Promise<FoodPublication> {
    if (!validPostSelection(source))
      throw new BadRequestException(
        'Choose exactly the source fields for this type of post.',
      );
    let publication: FoodPublication;
    if (
      source.kind === 'entry' ||
      source.kind === 'meal' ||
      source.kind === 'day'
    ) {
      const rows = await this.entries
        .find({
          userId,
          ...(source.kind === 'entry'
            ? { _id: source.entryId }
            : {
                day: toDay(source.day!),
                ...(source.kind === 'meal' ? { slot: source.slot } : {}),
              }),
        })
        .sort({ createdAt: 1, _id: 1 })
        .limit(MAX_POST_ITEMS + 1)
        .lean();
      if (!rows.length)
        throw new NotFoundException(
          'No logged foods found for that selection.',
        );
      const foods = await this.foods
        .find({ userId, _id: { $in: rows.map((row) => row.foodId) } })
        .lean();
      const items = rows.map((row, i) => {
        const food = foods.find((f) => String(f._id) === row.foodId);
        const attribution = food ? this.attribution(food) : undefined;
        return {
          ...this.item(row.facts, row.unit, String(i)),
          amount: row.amount,
          slot: row.slot as PublishedFood['slot'],
          ...(attribution ? { attribution } : {}),
        };
      });
      publication = {
        kind: source.kind,
        label:
          source.kind === 'entry'
            ? items[0].name
            : source.kind === 'meal'
              ? `${source.slot} · ${source.day}`
              : `Meals · ${source.day}`,
        day: source.kind === 'entry' ? rows[0].day : source.day,
        ...(source.kind !== 'day'
          ? { slot: rows[0].slot as PublishedFood['slot'] }
          : {}),
        items,
      };
    } else if (source.kind === 'food' || source.kind === 'database') {
      const rows = await this.foods
        .find({
          userId,
          archived: false,
          ...(source.kind === 'food' ? { _id: source.foodId } : {}),
        })
        .sort({ name: 1, _id: 1 })
        .limit(MAX_POST_ITEMS + 1)
        .lean();
      if (!rows.length)
        throw new NotFoundException('There are no foods to share.');
      publication = {
        kind: source.kind,
        label: source.kind === 'food' ? rows[0].name : 'My food database',
        items: rows.map((f, i) => this.fromFood(f, String(i))),
      };
    } else {
      let components = source.components!;
      let label = 'Food combination';
      let slot: FoodPublication['slot'];
      if (source.savedMealId) {
        const meal = await this.meals
          .findOne({ userId, _id: source.savedMealId, archived: false })
          .lean();
        if (!meal) throw new NotFoundException('Saved meal not found.');
        components = meal.components;
        label = meal.name;
        slot = meal.defaultSlot as FoodPublication['slot'];
      }
      const rows = await this.foods
        .find({
          userId,
          archived: false,
          _id: { $in: components.map((c) => c.foodId) },
        })
        .lean();
      const items = components.map((c, i) => {
        const food = rows.find((f) => String(f._id) === c.foodId);
        if (!food)
          throw new NotFoundException(
            'A selected food is no longer available.',
          );
        return this.fromFood(food, String(i), c.amount);
      });
      publication = {
        kind: 'combination',
        label,
        ...(slot ? { slot } : {}),
        items,
      };
    }
    if (!publication.items.length || publication.items.length > MAX_POST_ITEMS)
      throw new BadRequestException(
        `Share between 1 and ${MAX_POST_ITEMS} foods at a time.`,
      );
    return publication;
  }
  private importKey(postId: string, item: PublishedFood) {
    return `${postId}:${createHash('sha256').update(publicationFoodIdentity(item)).digest('hex')}`;
  }
  private async matches(
    userId: string,
    postId: string,
    items: PublishedFood[],
  ) {
    const rows = await this.foods.find({ userId }).lean();
    return items.map((item) => ({
      item,
      imported: rows.find(
        (row) => row.postImportKey === this.importKey(postId, item),
      ),
      duplicate: rows.find(
        (row) =>
          row.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
          (row.brand ?? '').trim().toLowerCase() ===
            (item.brand ?? '').trim().toLowerCase() &&
          row.unit === item.unit,
      ),
    }));
  }
  async importPreview(
    userId: string,
    postId: string,
    publication: FoodPublication,
  ): Promise<PostImportPreview> {
    const rows = await this.matches(userId, postId, publication.items);
    return {
      items: rows.map(({ item, imported, duplicate }) => ({
        key: item.key,
        alreadyImported: !!imported,
        ...(duplicate && !imported ? { duplicateName: duplicate.name } : {}),
      })),
      canSaveMeal:
        publication.kind === 'meal' || publication.kind === 'combination',
    };
  }
  async import(
    userId: string,
    postId: string,
    authorName: string,
    publication: FoodPublication,
    keys: string[],
    duplicatePolicy: 'skip' | 'copy',
    saveAsMeal: boolean,
    mealName?: string,
  ): Promise<PostImportResult> {
    if (keys.some((key) => !publication.items.some((item) => item.key === key)))
      throw new BadRequestException('Choose foods from this post.');
    const selected = publication.items.filter((item) =>
      keys.includes(item.key),
    );
    if (!selected.length)
      throw new BadRequestException('Select at least one food.');
    const rows = await this.matches(userId, postId, selected);
    const skipped = rows.filter(
      (r) => !r.imported && r.duplicate && duplicatePolicy === 'skip',
    );
    if (
      saveAsMeal &&
      (!(publication.kind === 'meal' || publication.kind === 'combination') ||
        selected.length !== publication.items.length ||
        skipped.length)
    )
      throw new BadRequestException(
        'To save this meal, select every food and choose Copy for matching food names.',
      );
    const eligible = rows.filter((r) => !skipped.includes(r));
    const unique = [
      ...new Map(
        eligible.map((r) => [this.importKey(postId, r.item), r]),
      ).entries(),
    ];
    if (saveAsMeal) {
      const amounts = new Map<string, number>();
      for (const [key] of unique)
        amounts.set(
          key,
          eligible
            .filter((r) => this.importKey(postId, r.item) === key)
            .reduce((n, r) => n + (r.item.amount ?? r.item.servingSize), 0),
        );
      if ([...amounts.values()].some((amount) => amount > 20000))
        throw new BadRequestException(
          'A saved meal component cannot exceed 20000 base units.',
        );
    }
    let createdCount = 0;
    // Upserts are independent/idempotent. A retry resumes an interrupted collection import.
    for (const [key, { item }] of unique) {
      const { key: _key, amount: _amount, slot: _slot, ...facts } = item;
      try {
        const result = await this.foods.updateOne(
          { userId, postImportKey: key },
          {
            $setOnInsert: {
              ...facts,
              userId,
              postImportKey: key,
              source: 'imported',
              sourceRef: `post:${postId}`,
              attribution: item.attribution ?? {
                label: `Shared by ${authorName}`,
              },
              entryMode: 'per_100',
              favourite: false,
              archived: false,
              visibility: 'private',
              privacyVersion: 1,
            },
          },
          { upsert: true },
        );
        createdCount += result.upsertedCount;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
    let savedMealId: string | undefined;
    if (saveAsMeal) {
      const copies = await this.foods
        .find({ userId, postImportKey: { $in: unique.map(([key]) => key) } })
        .lean();
      const components = unique.map(([key]) => ({
        foodId: String(copies.find((f) => f.postImportKey === key)!._id),
        amount: eligible
          .filter((r) => this.importKey(postId, r.item) === key)
          .reduce((n, r) => n + (r.item.amount ?? r.item.servingSize), 0),
      }));
      try {
        await this.meals.updateOne(
          { userId, postImportKey: postId },
          {
            $setOnInsert: {
              userId,
              postImportKey: postId,
              name: mealName?.trim() || publication.label,
              components,
              ...(publication.slot ? { defaultSlot: publication.slot } : {}),
              archived: false,
            },
          },
          { upsert: true },
        );
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
      const meal = await this.meals
        .findOne({ userId, postImportKey: postId })
        .lean();
      savedMealId = String(meal!._id);
    }
    return {
      createdCount,
      reusedCount: unique.length - createdCount,
      skippedCount: skipped.length,
      ...(savedMealId ? { savedMealId } : {}),
    };
  }
}
