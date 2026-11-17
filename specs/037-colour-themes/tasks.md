# Tasks: Colour themes

## Phase 1: Roles

- [x] T001 `THEME_ROLES` with v0 values (`libs/shared/types/src/lib/theme.ts`)
- [x] T002 Pure functions and tests (`libs/shared/domain/src/lib/theme.ts`): `validColour`, `completeTheme`, `themeCss`, `contrastRatio`, `themeProblems`
- [x] T003 `global.css` declares every role from v0; Tailwind exposes every role; remove the per-shade text remap
- [x] T004 Migrate raw palette classes in `apps/web/src` to roles (codemod), then review the exceptions
- [x] T005 Macro colours, the status-bar colour and other themable literals read roles; `MACRO_HEX` for images made outside the page
- [x] T006 Tests: the stylesheet matches `THEME_ROLES`; no raw palette class remains outside the allowlist

## Phase 2: Themes as data

- [ ] T007 `themes` module: schema, v0 seeding, `GET /themes/active`
- [ ] T008 Admin routes: list, duplicate, update with `baseVersion`, delete, activate; validation; tests

## Phase 3: Applying

- [ ] T009 `lib/theme-runtime.ts`: apply, keep, re-validate; pre-paint script in the root layout
- [ ] T010 Fetch on sign-in and on return to the foreground; status-bar colour follows the surface

## Phase 4: Admin page

- [ ] T011 `/settings/themes`: list, duplicate, rename, delete, activate
- [ ] T012 Editor with live preview in both modes and readability problems

## Phase 5: The new look

- [ ] T013 Concept sheet: v0 beside the new theme on sample screens, both modes
- [ ] T014 Add the approved theme; docs (`docs/modules/themes.md`, `DECISIONS.md`, `CHANGELOG.md`, `CLAUDE.md`)
