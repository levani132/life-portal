# Themes

Spec: `specs/037-colour-themes/`. Every colour on the page is a **role**; a **theme** is one
colour per role for light and for dark; one theme is **active** for the whole app.

## Roles

`THEME_ROLES` in `libs/shared/types/src/lib/theme.ts` is the single list: id, label, group and
the v0 value for light and dark. A role is a CSS variable `--<id>` holding `r g b` (three
numbers, 0 to 255), used through Tailwind as `text-ink`, `bg-accent-solid/20` and so on.

| Group | Roles |
| --- | --- |
| Surfaces and text | `surface`, `surface-raised`, `border`, `ink`, `ink-muted`, `ink-faint` |
| Accent | `accent`, `accent-hover`, `accent-solid`, `accent-solid-hover`, `on-accent` |
| Status | `success`, `warning`, `danger`, `info`, `special`, `fresh`, each with `-solid` |
| Nutrition | `macro-kcal`, `macro-protein`, `macro-carbs`, `macro-fat`, each with `-text` |
| Training | `train-push`, `train-pull`, `train-legs`, `train-core`, `train-arms`, `train-cardio`, each with `-solid` |

A plain status or training role is **text on a surface**. Its `-solid` twin is a **fill, border
or tint** (use it with an opacity for a tint: `bg-danger-solid/10`). A `macro-*` role is a fill
or stroke; `macro-*-text` is the same colour as words.

The same list is named in three places, and `apps/web/src/lib/theme-roles.spec.ts` keeps them in
step: `THEME_ROLES`, the three variable blocks in `apps/web/src/app/global.css` (the built-in v0)
and the colour list in `apps/web/tailwind.config.js`.

**Adding a role:** add it to `THEME_ROLES`, to the three blocks in `global.css` and to the
Tailwind list. Stored themes need no migration: a theme without the role gets v0's value for it
(`completeValues`).

### Not roles

The same test stops a raw palette class (`text-emerald-400`) or colour literal from coming back
into `apps/web/src`, except in its allowlist: white and black over photos, video and gradient
cards; the dark text of a white button on a gradient; other companies' brand colours (share
sheet, Google button); the camera's record red; rank emblem materials and plate; and images made
for outside the page (share image, link preview, manifest, the static `themeColor`), which keep
fixed inks (`MACRO_HEX`) because a canvas cannot read a variable.

## Data

| Collection | Fields |
| --- | --- |
| `themes` | `name`, `version` (starts at 1, +1 per save), `light`, `dark` (role id → `r g b`), timestamps |
| `theme_settings` | one row `key: 'active'`, `themeId` (a theme id or `v0`). Absent: v0 |

Neither has a `userId`: a theme belongs to the app. **v0 is not a row.** It is `THEME_V0` in
code, so it cannot be edited, deleted or lost; if the active theme is missing, the API answers
v0.

## Endpoints

| Route | Who | What |
| --- | --- | --- |
| `GET /themes/active` | any signed-in account | `{ id, version, light, dark }`, every role present, `no-store` |
| `GET /themes` | developer | `{ activeId, themes }`, v0 first |
| `POST /themes` | developer | `{ name, from? }`: a copy of `from` (a theme id, `v0` or `preset:<id>`; default v0). At most 50 |
| `PATCH /themes/:id` | developer | `{ name?, light?, dark?, baseVersion }`. Sent roles replace stored ones |
| `DELETE /themes/:id` | developer | Not v0, not the active one. Already gone: success |
| `POST /themes/:id/activate` | developer | Refused while the theme fails a readability check |

Refusals: `THEME_BUILT_IN` (409), `THEME_ACTIVE` (409), `STALE_EDIT` (409, with `current`),
`THEME_UNREADABLE` (422, with `problems`). There is no `@Public()` route: the sign-in screens
use the theme the device kept, or v0.

## Rules (pure, in `libs/shared/domain/src/lib/theme.ts`)

- **A colour is exactly `r g b`.** `validColour` accepts nothing else, on save (`valuesProblem`),
  on read (`completeValues`) and again when the stylesheet is built (`themeCss`), because the
  values are written into a stylesheet on every device.
- **Readability** (`themeProblems`, WCAG contrast ratio, both modes): text and secondary text on
  the page and on cards, links and text on the accent button need 4.5:1; faint text and status
  text on cards need 3:1 (`READABILITY_PAIRS`). A theme with a problem cannot be activated, and
  the active theme cannot be saved into one.

## On the device

1. The root layout's pre-paint script (`themeBootScript()`) reads `localStorage['lp.theme.active.v1']`,
   re-checks every value and adds `<style id="lp-theme">` before the first paint. So the app
   opens in its theme with no flash and with no connection. A test runs the script and compares
   its output with `themeCss`.
2. `ThemeLoader` fetches `GET /themes/active` once signed in, and again when the app returns to
   the foreground or the network comes back. A theme with a different id or version is applied
   and kept (`lib/theme-runtime.ts`). v0 removes the override and the kept copy.
3. The theme's rules are `html:root…`, one step more specific than `global.css`'s `:root…`, so
   they win wherever the `<style>` element sits.
4. The status-bar colour follows `--surface`.

What is kept is colours and a version. It is the same for every account, so it stays through
sign-out and is not one of spec 027's offline stores.

## Admin page

`/settings/themes` (menu → Themes, developer only): list with swatches, Activate, Edit,
Duplicate, Delete. The editor has a colour picker and hex field per role, a light/dark switch, a
live preview (a subtree whose variables are the unsaved values) and the readability problems.

## Ready-made themes

`THEME_PRESETS` (shared types) are themes shipped with the app, currently **Crisp**: black on
white, neutral greys, saturated colour, true black in dark. A preset is only a source: the admin
adds a copy ("Add Crisp"), which is an ordinary editable theme, and activates that. A preset is
never active itself and is not a row. A test requires each preset to have every role and no
readability problem. To add a look, add a preset; do not change v0.
