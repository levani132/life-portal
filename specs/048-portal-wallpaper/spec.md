# Spec 048: Portal wallpaper

Asked by the owner on 2026-11-28, after seeing two concepts (a wallpaper behind the whole portal,
or a cover photo in the header card). Chosen: the wallpaper, running under the iPhone status bar.

## What it is

- A picture behind the whole portal, fixed like a phone's wallpaper. The header card turns to
  glass; the widgets are already glass. A veil of the theme's own surface darkens (in light mode,
  lightens) it towards the bottom and as the page scrolls, so text stays readable.
- **Ten presets drawn for the app** (`apps/web/scripts/wallpapers.mjs` → `public/wallpapers/*.jpg`),
  each fading to near-black at the bottom, for people who don't know what to upload. Or the
  person's **own photo**, or none.
- Shown to everyone who can open the portal, like the profile photo; to visitors without an
  account on the open portal too (which is only there for people findable by strangers).
- **Pages have one too** (owner, 2026-11-28): set by a manager acting as the page, or by its
  assistant with `set_page_wallpaper` (a preset, a checked upload, or `remove`).

## Chrome

- While a portal with a wallpaper is the one on screen, `html[data-wallpaper]` makes the app's
  header see-through, so the picture reaches the top of the screen (under the status bar in the
  installed iPhone app, which uses `black-translucent`).
- Android cannot draw under its status bar; it takes the `theme-color`. `ThemeSync` uses the
  wallpaper's top colour (`data-wallpaper-top`) while it is on screen: each preset's is listed in
  `PORTAL_WALLPAPERS`; an own photo's is measured in the browser from the signed link.
- A kept tab that is hidden is `inert`; its wallpaper gives the chrome back.
- The picture is portalled to `<body>`: pull-to-refresh and tab swipes transform the page, and a
  transformed ancestor would drag a `fixed` picture along (the pull showed a bare band above it).

## Storage and privacy

- `social_profiles.wallpaper` (a preset's id) or `wallpaperKey` (never both). The key never
  leaves the API; responses carry `{ preset }` or a signed `{ url }`.
- An own photo is scaled to 2560 px on its longest side and re-encoded on the device
  (`prepareWallpaper`, which strips its location), uploaded like any photo, copied under
  `wallpapers/<user>/`, and checked by the photo check before it is used, like a profile photo.
- Replacing or removing it deletes the old file; deleting the account deletes it
  (`wallpaperKey` is a storage field). Privacy policy updated; `LEGAL_VERSION` 2026-11-28.

## Routes

- `PUT /api/social/me/wallpaper` `{ preset }` or `{ mediaId }` → `{ wallpaper }`.
- `DELETE /api/social/me/wallpaper`.

Tested: `integration/portal-wallpaper.integration.ts`, the screen test "a wallpaper fills the
portal…" and `account.spec.ts` (the file is found for deletion).
