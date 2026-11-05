/**
 * The one palette for calories and macros, used by every view that shows them: the Home widget,
 * the Food page, posts, rings, Story images and link previews. Calories are green (energy),
 * protein purple, carbs blue, fat amber. Change a colour here, never at a call site.
 */
export const MACRO_COLORS = {
  kcal: '#34d399',
  protein: '#a78bfa',
  carbs: '#38bdf8',
  fat: '#fbbf24',
} as const;

/** The same colours as text classes (the light theme remaps these for contrast). */
export const MACRO_TEXT = {
  kcal: 'text-emerald-400',
  protein: 'text-violet-400',
  carbs: 'text-sky-400',
  fat: 'text-amber-400',
} as const;
