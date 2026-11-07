'use client';

import clsx from 'clsx';
import {
  Apple,
  Banana,
  Beef,
  Beer,
  CakeSlice,
  Candy,
  Carrot,
  Cherry,
  Citrus,
  Coffee,
  Cookie,
  Croissant,
  CupSoda,
  Donut,
  Drumstick,
  Egg,
  Fish,
  Grape,
  Ham,
  IceCreamCone,
  Leaf,
  Milk,
  Nut,
  Pizza,
  Popcorn,
  Salad,
  Sandwich,
  Soup,
  Utensils,
  Wheat,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import { macroShares } from '@life-portal/shared-domain';
import { MACRO_COLORS } from '../lib/macro-colors';

/** First match wins, so the more specific words come first ("egg" before "bread" in "egg bread"). */
const ICONS: [RegExp, LucideIcon][] = [
  [/egg|omelet|яйц|კვერცხ/i, Egg],
  [/chicken|turkey|wing|drumstick|ქათამ/i, Drumstick],
  [/beef|steak|burger|mince|pork|lamb|kebab|meat|ხორც/i, Beef],
  [/ham|bacon|sausage|salami/i, Ham],
  [/fish|salmon|tuna|cod|shrimp|prawn|sushi|თევზ/i, Fish],
  [/pizza/i, Pizza],
  [/sandwich|wrap|lavash|toast|burrito|taco/i, Sandwich],
  [/soup|broth|stew|borscht|წვნიან/i, Soup],
  [/salad|lettuce|spinach|kale/i, Salad],
  [/croissant|pastry|bread|bun|bagel|khachapuri|ხაჭაპურ|პურ/i, Croissant],
  [/rice|oat|porridge|cereal|granola|pasta|noodle|buckwheat|grain|quinoa|wheat/i, Wheat],
  [/milk|yogurt|yoghurt|kefir|cheese|curd|cottage|matsoni|მაწონ|ყველ/i, Milk],
  [/shake|protein bar|whey/i, CupSoda],
  [/coffee|latte|espresso|cappuccino|tea/i, Coffee],
  [/beer/i, Beer],
  [/wine/i, Wine],
  [/juice|soda|cola|smoothie|drink/i, CupSoda],
  [/ice cream|gelato/i, IceCreamCone],
  [/cake|brownie|cheesecake/i, CakeSlice],
  [/donut|doughnut/i, Donut],
  [/cookie|biscuit|cracker/i, Cookie],
  [/chocolate|candy|sweet|sugar|bar\b/i, Candy],
  [/popcorn|chips|crisps/i, Popcorn],
  [/nut|almond|walnut|peanut|cashew|seed/i, Nut],
  [/banana/i, Banana],
  [/apple|pear/i, Apple],
  [/orange|lemon|lime|citrus|mandarin|tangerine/i, Citrus],
  [/grape|raisin/i, Grape],
  [/cherry|berry|berries|strawberr/i, Cherry],
  [/carrot|potato|tomato|cucumber|pepper|vegetable|veggie|broccoli/i, Carrot],
  [/bean|lentil|tofu|vegan|green/i, Leaf],
];

export function foodIcon(name: string): LucideIcon {
  return ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? Utensils;
}

/** The macro that brings most of the calories, which tints the icon tile. */
export function dominantMacroColor(macros: {
  proteinMg: number;
  carbMg: number;
  fatMg: number;
}): string {
  const shares = macroShares(macros);
  const max = Math.max(shares.protein, shares.carbs, shares.fat);
  if (max === 0) return MACRO_COLORS.kcal;
  if (max === shares.protein) return MACRO_COLORS.protein;
  if (max === shares.carbs) return MACRO_COLORS.carbs;
  return MACRO_COLORS.fat;
}

/**
 * A food's picture, or — when it has none — an icon guessed from its name on a tile tinted by
 * its main macro (protein purple, carbs blue, fat amber), so a list reads at a glance.
 */
export function FoodThumb({
  name,
  imageUrl,
  macros,
  size = 36,
  className,
}: {
  name: string;
  imageUrl?: string;
  macros: { proteinMg: number; carbMg: number; fatMg: number };
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        style={style}
        className={clsx('shrink-0 rounded-lg object-cover', className)}
      />
    );
  }
  const Icon = foodIcon(name);
  const color = dominantMacroColor(macros);
  return (
    <span
      aria-hidden
      style={{ ...style, color, backgroundColor: `${color}26` }}
      className={clsx('flex shrink-0 items-center justify-center rounded-lg', className)}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  );
}

/**
 * The same picture as `FoodThumb`, filling its container — for a food card. Without a photo it
 * is a soft gradient in the main macro's colour with a large icon, so a grid of foods never
 * looks like a wall of grey boxes.
 */
export function FoodArt({
  name,
  imageUrl,
  macros,
  className,
}: {
  name: string;
  imageUrl?: string;
  macros: { proteinMg: number; carbMg: number; fatMg: number };
  className?: string;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        className={clsx('h-full w-full object-cover', className)}
      />
    );
  }
  const Icon = foodIcon(name);
  const color = dominantMacroColor(macros);
  return (
    <span
      aria-hidden
      className={clsx('flex h-full w-full items-center justify-center', className)}
      style={{
        color,
        backgroundImage: `radial-gradient(circle at 30% 25%, ${color}40, ${color}14 70%)`,
      }}
    >
      <Icon className="h-2/5 w-2/5" strokeWidth={1.6} />
    </span>
  );
}
