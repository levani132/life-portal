# Feature Specification: Colour themes

**Feature Branch**: `037-colour-themes`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "Create themes that an admin can control and create: take all the colours used anywhere in the application and move them into configuration that comes from the database, loaded the first thing the app starts, and cached on the device for offline. Then new themes are just new values. For now there is v0 (today's colours), and then a new set of colours: the current ones feel pale, not professional or premium. Premium in the sense of Instagram: well-defined colours and strong contrast, black over white, not gold."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every colour in the app comes from one named set (Priority: P1)

Today the app's colours are spread across the stylesheet and hundreds of individual screens. After this, every colour a person sees in the app's own interface is one of a fixed list of named roles (page background, card, text, accent, success, warning, danger, each macro, each muscle group, and so on), each with a light-mode and a dark-mode value. That list, filled with today's colours, is the theme called **v0**. Nothing looks different yet.

**Why this priority**: Nothing else is possible without it. A theme can only change what is already a named role; a colour left written into a screen stays that colour forever.

**Independent Test**: With v0 active, walk every screen in light and in dark mode and compare with before: no screen has changed beyond the small, listed consolidations. Then change one role's value (for example, danger) and confirm every danger colour in the app changes, and nothing else does.

**Acceptance Scenarios**:

1. **Given** the app with v0 active, **When** a person uses any screen in light or dark mode, **Then** it looks as it did before this feature, apart from shades deliberately merged into one role, which are listed.
2. **Given** a role's value is changed in the active theme, **When** the app is opened, **Then** every place that role is used shows the new colour, in the mode it was changed for.
3. **Given** the list of roles, **When** someone looks for a colour written directly into a screen of the app's own interface, **Then** there is none, except the documented exceptions (see Assumptions).

---

### User Story 2 - The admin creates and edits themes (Priority: P1)

The admin opens a Themes page. It lists the themes, shows which is active, and lets them duplicate a theme, rename it, and edit each role's colour for light and for dark mode, seeing the result on real interface samples as they edit. A theme whose text would be too hard to read on its background is flagged before it can be saved as usable.

**Why this priority**: This is what the owner asked for: themes as data they control, not as code changes.

**Independent Test**: Duplicate v0 as "Test", change the accent and the page background, save, and reopen: the values are kept. Try to set the text colour equal to the background: it is flagged and cannot be activated.

**Acceptance Scenarios**:

1. **Given** the admin on the Themes page, **When** they duplicate v0, **Then** a new theme with the same values and a name they choose exists, and v0 is unchanged.
2. **Given** a theme being edited, **When** the admin changes a role's colour, **Then** a live preview shows that role on sample buttons, cards, text, charts and chips in both modes, before anything is saved.
3. **Given** a theme where body text on the page background, or text on the accent button, falls below readable contrast, **When** the admin tries to activate it, **Then** activation is refused and the failing pairs are named.
4. **Given** someone who is not the admin, **When** they try to open the Themes page or change a theme, **Then** they cannot.
5. **Given** v0, **When** the admin tries to edit or delete it, **Then** it is refused: v0 is the fixed reference. It can be duplicated.
6. **Given** a theme that is active, **When** the admin tries to delete it, **Then** it is refused until another theme is active.

---

### User Story 3 - The admin activates a theme and everyone gets it (Priority: P1)

The admin picks a theme and activates it. From then on everyone sees the app in that theme, in their own light or dark mode. A device that has seen the theme shows it immediately on the next open, even with no connection.

**Why this priority**: A theme nobody sees is not a feature.

**Independent Test**: Activate "Test". On another device, open the app: after it has loaded once it is in the new colours; close it, go offline, open it again: it opens in the new colours with no flash of the old ones.

**Acceptance Scenarios**:

1. **Given** the admin activates a theme, **When** another member next opens or returns to the app with a connection, **Then** the app changes to that theme without them doing anything.
2. **Given** a device that has loaded the active theme before, **When** the app is opened, **Then** it is painted in that theme from the first frame, with no flash of other colours, online or offline.
3. **Given** a device that has never loaded a theme (first visit, or cleared storage), **When** the app is opened, **Then** it shows v0 until the active theme arrives, and then changes to it.
4. **Given** the admin edits the active theme and saves, **When** members next open or return to the app, **Then** they get the edited colours.
5. **Given** a member's choice of light, dark or system, **When** the theme changes, **Then** their choice still applies: a theme has both modes.
6. **Given** the theme cannot be loaded (no connection, an error), **When** the app opens, **Then** it uses the last theme it has, or v0, and never opens unstyled or unreadable.

---

### User Story 4 - A new, higher-contrast theme (Priority: P2)

A second theme is designed to replace v0 as the default look: stronger contrast, cleaner neutrals and better-defined colours, in light and dark. The owner sees it on a concept sheet first, applied to real screens, and approves or changes it before it becomes the active theme.

**Why this priority**: It is the reason for the whole feature, but it is only values once stories 1 to 3 exist.

**Independent Test**: The concept sheet shows the new theme beside v0 on the same screens in both modes. After approval it exists as a theme, passes the contrast checks, and can be activated and reverted to v0 in one step.

**Acceptance Scenarios**:

1. **Given** the concept sheet, **When** the owner compares v0 and the new theme, **Then** each is shown on the same sample screens (Home, Food, Training, a post, a form) in light and dark.
2. **Given** the owner approves it, **When** it is added, **Then** it is an ordinary theme: listed, editable, activatable, with v0 still available.
3. **Given** the new theme is active and the owner dislikes it in use, **When** they activate v0 again, **Then** the app returns to today's colours.

---

### Edge Cases

- A theme saved by an older version of the app lacks a role added later: the missing role takes v0's value, in both modes, and the theme stays usable.
- A value that is not a colour (malformed, or an attempt to inject styling) is refused on save and never reaches a device.
- Two admin sessions edit the same theme: the later save does not silently undo the earlier one; it is told the theme changed.
- The active theme is edited while a member has the app open: their open app changes the next time it checks, not mid-interaction in a way that loses what they were doing.
- The signed-out screens (sign in, register, reset password): they use the theme the device last had, or v0 on a device that has none.
- Images made by the app for use outside it (a share image, a link preview), brand marks (the Google button) and illustrations (rank emblems, muscle figures' fixed parts): see Assumptions for which follow the theme.
- A member's device has the previous theme cached and is offline for weeks: it keeps that theme until it next connects.
- The admin activates a theme with a very different background: the browser and phone status bar colour follow it.

## Requirements *(mandatory)*

### Functional Requirements

**Roles**

- **FR-001**: Every colour in the app's own interface MUST be a named role with a light-mode and a dark-mode value. The roles MUST cover at least: page and raised surfaces, borders, the three text strengths, the accent and its text, success, warning, danger and information (each as text and as a fill), the four nutrition colours, the six training muscle-group colours, and the surfaces and edges of glass elements.
- **FR-002**: No screen of the app's own interface MAY use a colour that is not a role, except the documented exceptions.
- **FR-003**: The theme v0 MUST hold today's colours, so that with v0 active the app looks as it did, apart from listed shade consolidations.
- **FR-004**: A role added to the app later MUST work with every existing theme: a theme without a value for it uses v0's.

**Themes as data**

- **FR-005**: A theme MUST consist of a name and, for each role, a light and a dark value. Themes MUST be stored by the service, not shipped only in the app's code; v0 MUST also exist in the app itself, as the fallback that never needs loading.
- **FR-006**: Only the admin MUST be able to list all themes for editing, create (by duplicating), rename, edit, delete and activate them. v0 MUST NOT be editable or deletable. The active theme MUST NOT be deletable.
- **FR-007**: A colour value MUST be accepted only if it is a plain colour. Anything else MUST be refused, so that a theme can never carry anything but colours to a device.
- **FR-008**: Saving a theme MUST be refused when someone else changed it since it was opened, with the option to reload.
- **FR-009**: The editor MUST show each change live on interface samples in both modes before saving.
- **FR-010**: A theme MUST pass readability checks before it can be activated: body text and muted text on the page and raised surfaces, text on the accent fill, and each status colour's text on the surfaces. The failing pairs MUST be named. A theme that fails can still be saved as a draft.

**Applying a theme**

- **FR-011**: Exactly one theme MUST be active for the whole app at a time. Activating a theme MUST take effect for every member the next time their app opens or returns to the foreground with a connection.
- **FR-012**: A device MUST keep the active theme it last loaded and paint the app with it from the first frame on the next open, with or without a connection, and without a flash of other colours.
- **FR-013**: A device with no kept theme MUST show v0 until the active theme has loaded.
- **FR-014**: The app MUST never be unreadable because of theming: any failure to load or read a theme falls back to the kept theme, then to v0.
- **FR-015**: A member's light, dark or system preference MUST keep working with every theme.
- **FR-016**: The browser and status-bar colour MUST follow the active theme's page surface in the current mode.
- **FR-017**: The theme a device keeps MUST hold colours only: no account, no personal data.

**The new look**

- **FR-018**: A second theme with stronger contrast and better-defined colours MUST be designed, shown to the owner beside v0 on the same sample screens in both modes, and added only as approved. v0 MUST remain available to return to.

### Key Entities *(include if feature involves data)*

- **Role**: a named place colour is used (for example "page surface", "danger text", "protein"). The list of roles is part of the app; each has a v0 light and dark value.
- **Theme**: a name plus a light and a dark value for each role, a marker for v0 (fixed), and when it last changed.
- **Active theme**: the one theme the whole app currently uses.
- **Kept theme**: a device's own copy of the active theme's colours, used to paint before anything loads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With v0 active, a side-by-side check of every main screen in both modes shows no difference from before, other than the listed consolidations.
- **SC-002**: Changing any single role's value changes every use of that role and nothing else: verified for at least one role from each group.
- **SC-003**: 0 colours remain written directly into the app's own interface outside the documented exceptions.
- **SC-004**: The admin can duplicate a theme, change its accent and background, and activate it in under 2 minutes, without a code change or a release.
- **SC-005**: On a device that has loaded the active theme once, 100% of later opens, online or offline, show that theme from the first frame.
- **SC-006**: No theme that fails the readability checks can be activated: 0 exceptions.
- **SC-007**: A malformed or malicious colour value is refused in 100% of attempts and never reaches a device.

## Assumptions

Choices made here, for the owner to confirm:

- **One theme for the whole app.** The admin's active theme is what everyone sees. Members choosing their own theme is a possible later step and not part of this.
- **"Admin" is the developer account**, the same one that manages feature switches today.
- **A theme has both modes.** Light, dark and "follow the system" stay each member's own choice.
- **Signed-out screens use the device's kept theme, or v0.** The active theme is fetched once signed in, so nothing new is readable without an account. The cost: a brand-new device shows v0 on the sign-in screen even when another theme is active.
- **v0 merges near-identical shades.** Today the same meaning is drawn in several slightly different shades (for example four ambers for "warning"). Each meaning becomes one role with a text value and a fill value, so some places shift by a shade. These are listed in the plan. Exact pixel parity would need hundreds of one-off roles and defeat the purpose.
- **Not themed (documented exceptions):** white or black drawn over photos, video and the camera; text on coloured gradient cards (always white); third-party brand marks (the Google button); the materials of rank emblems (stone, bronze, gold, gems), which are illustrations; images the app makes for use outside it (share images, link previews) keep fixed colours for now.
- **Shapes are not part of a theme** in this feature: only colours. Rounded corners, spacing, type and the glass blur stay as they are. They can become theme settings later.
- **The new look is designed after the infrastructure**, on a concept sheet, and added only when the owner approves it.
- **Charts** use roles like everything else.
- Reuses the existing admin-only access, the device storage already used for the light or dark preference, and the offline rules: a kept theme is colours only, so it is not private data.
