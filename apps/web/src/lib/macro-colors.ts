/**
 * The one palette for calories and macros, used by every view that shows them: the Home widget,
 * the Food page, posts and rings. Calories are green (energy), protein purple, carbs blue, fat
 * amber. Since spec 037 they are colour roles (`--macro-*`), so the active theme sets them;
 * change a colour in a theme, never at a call site.
 */
export type MacroKey = 'kcal' | 'protein' | 'carbs' | 'fat';

/** For the page: fills, strokes and inline styles. */
export const MACRO_COLORS = {
  kcal: 'rgb(var(--macro-kcal))',
  protein: 'rgb(var(--macro-protein))',
  carbs: 'rgb(var(--macro-carbs))',
  fat: 'rgb(var(--macro-fat))',
} as const;

/** The same colours as text classes (their own roles, darker in light themes for contrast). */
export const MACRO_TEXT = {
  kcal: 'text-macro-kcal-text',
  protein: 'text-macro-protein-text',
  carbs: 'text-macro-carbs-text',
  fat: 'text-macro-fat-text',
} as const;

/**
 * Fixed inks for images made for use outside the page (the share image's canvas, the link
 * preview), where a CSS variable cannot be read. Not themed: one of spec 037's exceptions.
 */
export const MACRO_HEX = {
  kcal: '#34d399',
  protein: '#a78bfa',
  carbs: '#38bdf8',
  fat: '#fbbf24',
} as const;

/**
 * A role colour (`rgb(var(--role))`) at an opacity, for inline tints and borders. Colours here
 * are variables, so a hex alpha suffix cannot be appended to them.
 */
export function withAlpha(color: string, alpha: number): string {
  return color.startsWith('rgb(var(') ? color.replace(/\)\)$/, `) / ${alpha})`) : color;
}
