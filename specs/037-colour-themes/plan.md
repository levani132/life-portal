# Implementation Plan: Colour themes

**Feature**: `specs/037-colour-themes/spec.md` · **Date**: 2026-11-17

## Summary

Every colour in the app's own interface becomes a **role**: a CSS variable holding an `r g b`
triplet, with a light and a dark value. The list of roles and their v0 values live in the shared
types library, the stylesheet carries v0 as the built-in fallback, and a theme is a document of
role values the admin manages. A device keeps the active theme in local storage and paints with
it before first paint.

## Constitution check

| Principle | How this feature keeps it |
|---|---|
| I. Bounded module | A new `themes` module: one Nest module, one collection family, one settings route. It reads nothing from other modules. |
| III. Derived never persisted | The CSS a theme becomes is derived on the device from role values; only the values are stored. |
| V. Pure projections | Validation, contrast checks and CSS generation are pure functions in `libs/shared/domain/src/lib/theme.ts`, unit tested. |
| VI. Estimates labelled | Nothing estimated. |

## Roles (v0)

Values are `r g b`. Existing variables keep their names.

| Group | Roles |
|---|---|
| Surfaces and text (existing) | `surface`, `surface-raised`, `border`, `ink`, `ink-muted`, `ink-faint` |
| Accent (existing) | `accent`, `accent-hover`, `accent-solid`, `accent-solid-hover`, `on-accent` |
| Status, each as text and as a fill | `success` / `success-solid` (emerald), `warning` / `warning-solid` (amber), `danger` / `danger-solid` (rose), `info` / `info-solid` (sky), `special` / `special-solid` (violet), `fresh` / `fresh-solid` (lime) |
| Nutrition | `macro-kcal`, `macro-protein`, `macro-carbs`, `macro-fat` |
| Training (existing) | `train-{push,pull,legs,core,arms,cardio}` and `-solid` |

The text role is what a word or icon of that meaning is drawn in on a surface; the `-solid` role
is a fill that carries white text, and is also what tints (`/10`) and borders are made from.

## Consolidations in v0 (the listed differences)

- Text in `emerald`, `amber`, `rose` and `lime` used shades 100 to 400 in dark mode (remapped to
  one dark shade each in light mode). Each becomes one text role: the 400 shade in dark (lime:
  200), today's light value in light. Uses of the 100 to 300 shades in dark mode get slightly
  more saturated.
- Fills and borders used shades 400 and 500 (rarely 600). Each becomes the `-solid` role at the
  500 shade.
- Explicit pairs such as `text-amber-700 dark:text-amber-400` become the one text role.
- `text-sky-*` and `text-violet-*` had no light-mode remap; v0 keeps their bright values in
  both modes so nothing changes. (This is one of the pale spots the new theme fixes.)
- `bg-orange-500/10` (two post-kind tints) becomes the warning tint.

## Exceptions (not roles)

White and black over photos, video and the camera; white text and translucent white on gradient
cards and heroes, and the dark text of a white button on them (`slate`); brand gradients in the
share sheet; the Google button; rank emblem materials; the fixed inks of images made for use
outside the app (share image, link preview), which keep hex values (`MACRO_HEX`).

## Design

- **Contracts** (`libs/shared/types/src/lib/theme.ts`): `THEME_ROLES` (id, label, group, light,
  dark), `ThemeValues = Record<role, string>`, `Theme { id, name, builtIn, version, light, dark,
  updatedAt }`, `ActiveTheme { id, version, light, dark }`.
- **Domain** (`libs/shared/domain/src/lib/theme.ts`): `validColour`, `completeTheme` (fills
  missing roles from v0), `themeCss` (the stylesheet text for both modes), `contrastRatio`,
  `themeProblems` (the readability pairs that fail).
- **Stylesheet**: `global.css` declares every role with v0's values (light, `[data-theme=dark]`,
  and the system-dark media query). A test fails if it differs from `THEME_ROLES`.
- **Tailwind**: every role is a colour (`rgb(var(--role) / <alpha-value>)`). The per-shade text
  remap is removed.
- **API** (`apps/api/src/themes`): `themes` collection and a single `theme_settings` document
  naming the active one. `GET /themes/active` for any signed-in member; list, duplicate, update
  (with `baseVersion`), delete and activate for the developer only. v0 is seeded and immutable.
- **Web runtime** (`lib/theme-runtime.ts`): applies a theme by writing one `<style>` element;
  keeps it in `localStorage`; the root layout's pre-paint script re-creates that element from
  the kept copy, after re-validating every value. The shell fetches the active theme when signed
  in and on return to the foreground.
- **Admin page** (`/settings/themes`): list, duplicate, edit with live preview in both modes,
  readability problems, activate.

## Phases

1. **Roles**: contracts, domain, stylesheet and Tailwind; migrate every raw palette class and
   themable literal to roles; a test that none remain. No visual change beyond the consolidations.
2. **Themes as data**: API module, seeding v0, admin-only writes.
3. **Applying**: device cache, pre-paint, fetch and refresh, status-bar colour.
4. **Admin page**: editor, preview, readability checks, activation.
5. **The new look**: concept sheet, approval, add as a theme.
