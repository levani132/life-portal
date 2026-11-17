import { THEME_ROLES, THEME_V0, type ThemeValues } from '@life-portal/shared-types';

/**
 * Colour themes (spec 037): the pure parts. What counts as a colour, how a stored theme is made
 * whole, the stylesheet a theme becomes, and whether its text can be read.
 */

const TRIPLET = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/;

/**
 * Whether `value` is exactly `r g b`, each 0 to 255. A theme's values are written into a
 * stylesheet on every device, so nothing else is ever accepted: not a name, not a function, not
 * a stray character that could end the declaration.
 */
export function validColour(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = TRIPLET.exec(value);
  return !!match && match.slice(1).every((part) => Number(part) <= 255);
}

/**
 * A value for every role, and nothing else: a role the input lacks (a theme saved before the
 * role existed) or holds an invalid value for takes v0's; an unknown key is dropped.
 */
export function completeValues(values: Partial<ThemeValues> | undefined, mode: 'light' | 'dark'): ThemeValues {
  return Object.fromEntries(
    THEME_ROLES.map((role) => {
      const value = values?.[role.id];
      return [role.id, validColour(value) ? value : THEME_V0[mode][role.id]];
    }),
  );
}

/** What a save is refused for: an unknown role or a value that is not a colour. `null` when fine. */
export function valuesProblem(values: unknown): string | null {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return 'A theme needs a colour for each role.';
  const known = new Set(THEME_ROLES.map((role) => role.id));
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (!known.has(key)) return `"${key.slice(0, 40)}" is not a colour role.`;
    if (!validColour(value)) return `The colour for "${key}" must be three numbers from 0 to 255.`;
  }
  return null;
}

const declarations = (values: ThemeValues) =>
  THEME_ROLES.map((role) => `--${role.id}:${values[role.id]};`).join('');

/**
 * The stylesheet a theme becomes: its light values on the root, its dark values for an explicit
 * dark choice and for a dark system without an explicit light choice. The same three places
 * `global.css` declares v0 in, each one step more specific (`html:root`), so it overrides them
 * wherever the element sits in the page and overrides nothing else. Values are completed and
 * re-validated here, so this can only ever emit `--role:r g b;`.
 */
export function themeCss(theme: { light?: Partial<ThemeValues>; dark?: Partial<ThemeValues> }): string {
  const light = declarations(completeValues(theme.light, 'light'));
  const dark = declarations(completeValues(theme.dark, 'dark'));
  return `html:root{${light}}html:root[data-theme='dark']{${dark}}@media (prefers-color-scheme: dark){html:root:not([data-theme='light']){${dark}}}`;
}

/** Where a device keeps the active theme: colours only, so it is the same for every account. */
export const THEME_STORAGE_KEY = 'lp.theme.active.v1';
/** The `<style>` element a theme is applied through. */
export const THEME_STYLE_ID = 'lp-theme';

/**
 * The script the page runs before its first paint: reads the kept theme and applies it, so the
 * app opens in its colours with no flash of v0 and with no connection. It cannot import
 * anything, so it repeats `themeCss` in plain JavaScript, checking every value the same way; a
 * test runs it and compares the two. A kept theme that cannot be read applies nothing (v0).
 */
export function themeBootScript(): string {
  const roles = JSON.stringify(THEME_ROLES.map((role) => role.id));
  return (
    `(function(){try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||'null');if(!t||typeof t!=='object')return;` +
    `var R=${roles},x=/^(\\d{1,3}) (\\d{1,3}) (\\d{1,3})$/;` +
    `function d(v){var s='';if(!v||typeof v!=='object')return s;for(var i=0;i<R.length;i++){var c=v[R[i]],m=typeof c==='string'&&x.exec(c);` +
    `if(m&&+m[1]<=255&&+m[2]<=255&&+m[3]<=255)s+='--'+R[i]+':'+c+';'}return s}` +
    `var l=d(t.light),k=d(t.dark),e=document.createElement('style');e.id=${JSON.stringify(THEME_STYLE_ID)};` +
    `e.textContent="html:root{"+l+"}html:root[data-theme='dark']{"+k+"}@media (prefers-color-scheme: dark){html:root:not([data-theme='light']){"+k+"}}";` +
    `document.head.appendChild(e)}catch(e){}})()`
  );
}

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an `r g b` value. */
export function luminance(colour: string): number {
  const [r, g, b] = colour.split(' ').map(Number);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The pairs a theme must keep readable before it may be activated: text on its background, at
 * the WCAG AA ratio for body text (4.5) or, for faint text and status words, large or
 * supporting text (3).
 */
export const READABILITY_PAIRS: readonly { text: string; on: string; min: number; what: string }[] = [
  { text: 'ink', on: 'surface', min: 4.5, what: 'Text on the page background' },
  { text: 'ink', on: 'surface-raised', min: 4.5, what: 'Text on cards' },
  { text: 'ink-muted', on: 'surface', min: 4.5, what: 'Secondary text on the page background' },
  { text: 'ink-muted', on: 'surface-raised', min: 4.5, what: 'Secondary text on cards' },
  { text: 'ink-faint', on: 'surface-raised', min: 3, what: 'Faint text on cards' },
  { text: 'on-accent', on: 'accent-solid', min: 4.5, what: 'Text on the accent button' },
  { text: 'accent', on: 'surface-raised', min: 4.5, what: 'Links on cards' },
  { text: 'success', on: 'surface-raised', min: 3, what: 'Success text on cards' },
  { text: 'warning', on: 'surface-raised', min: 3, what: 'Warning text on cards' },
  { text: 'danger', on: 'surface-raised', min: 3, what: 'Danger text on cards' },
];

export interface ReadabilityProblem {
  mode: 'light' | 'dark';
  what: string;
  ratio: number;
  min: number;
}

/** The readability pairs a theme fails, in both modes. Empty: it may be activated. */
export function themeProblems(theme: { light?: Partial<ThemeValues>; dark?: Partial<ThemeValues> }): ReadabilityProblem[] {
  return (['light', 'dark'] as const).flatMap((mode) => {
    const values = completeValues(theme[mode], mode);
    return READABILITY_PAIRS.flatMap((pair) => {
      const ratio = contrastRatio(values[pair.text], values[pair.on]);
      return ratio < pair.min ? [{ mode, what: pair.what, ratio: Math.round(ratio * 100) / 100, min: pair.min }] : [];
    });
  });
}

/** `r g b` as `#rrggbb`, and back, for colour pickers and the status-bar colour. */
export function colourToHex(colour: string): string {
  return `#${colour.split(' ').map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
}
export function hexToColour(hex: string): string | undefined {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return match ? match.slice(1).map((part) => parseInt(part, 16)).join(' ') : undefined;
}
