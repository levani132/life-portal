/**
 * Colour themes (spec 037). Every colour in the app's own interface is a **role**: a CSS variable
 * `--<id>` holding an `r g b` triplet, with a light and a dark value. This list is the single
 * source of the roles and of **v0**, the theme that holds the colours the app had before themes.
 *
 * `apps/web/src/app/global.css` declares every role with these values, as the fallback that
 * never needs loading; a test fails if the two differ. A theme stored by the API is a set of
 * values for these roles; a role a stored theme lacks takes v0's value.
 */
export interface ThemeRole {
  id: string;
  label: string;
  group: 'Surfaces and text' | 'Accent' | 'Status' | 'Nutrition' | 'Training';
  /** `r g b`, each 0 to 255. */
  light: string;
  dark: string;
}

const role = (id: string, label: string, group: ThemeRole['group'], light: string, dark: string = light): ThemeRole => ({ id, label, group, light, dark });

export const THEME_ROLES: readonly ThemeRole[] = [
  role('surface', 'Page background', 'Surfaces and text', '245 247 250', '12 14 20'),
  role('surface-raised', 'Cards and raised surfaces', 'Surfaces and text', '255 255 255', '22 25 34'),
  role('border', 'Borders and dividers', 'Surfaces and text', '210 217 228', '40 45 58'),
  role('ink', 'Text', 'Surfaces and text', '24 32 47', '237 240 245'),
  role('ink-muted', 'Secondary text', 'Surfaces and text', '77 90 110', '155 163 180'),
  role('ink-faint', 'Faint text', 'Surfaces and text', '100 114 134', '133 143 162'),

  role('accent', 'Accent text and links', 'Accent', '3 105 161', '125 211 252'),
  role('accent-hover', 'Accent text, hovered', 'Accent', '7 89 133', '186 230 253'),
  role('accent-solid', 'Accent fill', 'Accent', '3 105 161', '14 165 233'),
  role('accent-solid-hover', 'Accent fill, hovered', 'Accent', '7 89 133', '56 189 248'),
  role('on-accent', 'Text on the accent fill', 'Accent', '255 255 255', '12 14 20'),

  // Each status is a text colour (a word or icon on a surface) and a fill (carries white text;
  // tints and borders are made from it).
  role('success', 'Success text', 'Status', '4 120 87', '52 211 153'),
  role('success-solid', 'Success fill', 'Status', '16 185 129'),
  role('warning', 'Warning text', 'Status', '146 64 14', '251 191 36'),
  role('warning-solid', 'Warning fill', 'Status', '245 158 11'),
  role('danger', 'Danger text', 'Status', '190 18 60', '251 113 133'),
  role('danger-solid', 'Danger fill', 'Status', '244 63 94'),
  role('info', 'Information text', 'Status', '56 189 248'),
  role('info-solid', 'Information fill', 'Status', '14 165 233'),
  role('special', 'Highlight text', 'Status', '167 139 250'),
  role('special-solid', 'Highlight fill', 'Status', '139 92 246'),
  role('fresh', 'Fresh text', 'Status', '77 124 15', '217 249 157'),
  role('fresh-solid', 'Fresh fill', 'Status', '132 204 22'),

  role('macro-kcal', 'Calories', 'Nutrition', '52 211 153'),
  role('macro-protein', 'Protein', 'Nutrition', '167 139 250'),
  role('macro-carbs', 'Carbs', 'Nutrition', '56 189 248'),
  role('macro-fat', 'Fat', 'Nutrition', '251 191 36'),
  // The same four as words and numbers on a surface.
  role('macro-kcal-text', 'Calories text', 'Nutrition', '4 120 87', '52 211 153'),
  role('macro-protein-text', 'Protein text', 'Nutrition', '167 139 250'),
  role('macro-carbs-text', 'Carbs text', 'Nutrition', '56 189 248'),
  role('macro-fat-text', 'Fat text', 'Nutrition', '146 64 14', '251 191 36'),

  role('train-push', 'Push', 'Training', '194 65 12', '251 146 60'),
  role('train-pull', 'Pull', 'Training', '29 78 216', '96 165 250'),
  role('train-legs', 'Legs', 'Training', '4 120 87', '52 211 153'),
  role('train-core', 'Core', 'Training', '161 72 8', '251 191 36'),
  role('train-arms', 'Arms', 'Training', '109 40 217', '167 139 250'),
  role('train-cardio', 'Cardio', 'Training', '190 24 93', '244 114 182'),
  role('train-push-solid', 'Push fill', 'Training', '194 65 12'),
  role('train-pull-solid', 'Pull fill', 'Training', '37 99 235'),
  role('train-legs-solid', 'Legs fill', 'Training', '4 120 87'),
  role('train-core-solid', 'Core fill', 'Training', '180 83 9'),
  role('train-arms-solid', 'Arms fill', 'Training', '124 58 237'),
  role('train-cardio-solid', 'Cardio fill', 'Training', '219 39 119'),
];

export const THEME_ROLE_IDS: readonly string[] = THEME_ROLES.map((item) => item.id);

/** A value for every role, `r g b` each. */
export type ThemeValues = Record<string, string>;

/** The fixed reference theme: the app's colours before themes. Never edited or deleted. */
export const THEME_V0_ID = 'v0';
export const THEME_V0_NAME = 'v0 (original)';
export const THEME_V0: { light: ThemeValues; dark: ThemeValues } = {
  light: Object.fromEntries(THEME_ROLES.map((item) => [item.id, item.light])),
  dark: Object.fromEntries(THEME_ROLES.map((item) => [item.id, item.dark])),
};

export const THEME_NAME_MAX = 60;

export interface Theme {
  id: string;
  name: string;
  /** v0: fixed, cannot be edited or deleted. */
  builtIn: boolean;
  /** Bumped on every save; sent back as `baseVersion` so a stale edit is refused. */
  version: number;
  light: ThemeValues;
  dark: ThemeValues;
  updatedAt: string;
}

/** What every signed-in device gets: colours only, nothing about anyone. */
export interface ActiveTheme {
  id: string;
  version: number;
  light: ThemeValues;
  dark: ThemeValues;
}

export interface ThemeList {
  activeId: string;
  themes: Theme[];
}
