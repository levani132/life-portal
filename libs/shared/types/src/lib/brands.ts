/**
 * Food brands. A brand is a name and, optionally, a logo. Public brands are for everyone;
 * a person's own brands are theirs alone. A food carries its brand as the brand's exact name,
 * so a food and its brand are joined by `brandKey(name)`, never by an id: foods saved before
 * brands existed, and foods imported from other people, match on their own.
 */
export interface FoodBrand {
  id: string;
  name: string;
  /** `brandKey(name)`: what two spellings of one brand share. */
  key: string;
  scope: 'public' | 'own';
  /** A signed link, when the brand has a logo. */
  logoUrl?: string;
}

export const BRAND_NAME_MAX = 60;
/** The most brands one person may have of their own. */
export const OWN_BRANDS_MAX = 300;

/** Refused: a brand with this name (in any spelling) already exists. Carries `existing`. */
export const BRAND_EXISTS = 'BRAND_EXISTS';

/**
 * Public brands every installation starts with: names only. Their logos are the brands' own
 * artwork, so they are added by the admin, never shipped in the code.
 */
export const STARTER_BRANDS: readonly string[] = [
  "McDonald's",
  "Wendy's",
  'Burger King',
  'KFC',
  'Subway',
  'Starbucks',
  "Domino's",
  'Pizza Hut',
  'Dunkin',
  'Taco Bell',
  'Coca-Cola',
  'Pepsi',
  'Nestlé',
  'Danone',
  'Barilla',
  'Heinz',
  "Kellogg's",
  'Lidl',
  'Carrefour',
  'Mercadona',
  'Nutella',
  'Oreo',
  'Red Bull',
  'Monster',
  'Milka',
  'Lindt',
  'Activia',
  'Philadelphia',
  'Pringles',
  "Lay's",
  'MyProtein',
  'Optimum Nutrition',
];
