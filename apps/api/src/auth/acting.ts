import { SetMetadata } from '@nestjs/common';

/**
 * How a route treats "acting as a page" (spec 040). A person who manages a page sends its id in
 * the `x-lp-act-as` header; `ActingGuard` then decides, from the route's marker, whether the
 * request runs as the page, as the person, or not at all.
 *
 * The default, for a route with no marker, is **refused while acting as a page**. So a new
 * route that logs something personal is closed to pages without anyone remembering to close it;
 * a route has to be opened to pages on purpose.
 */
export const ACT_MODE = 'actMode';
export type ActMode = 'person' | 'page';

/**
 * The route always runs as the signed-in person, whatever the header says: signing in, the
 * account, the pages a person manages, the admin screens, and the shell's own housekeeping.
 */
export const AsPerson = () => SetMetadata(ACT_MODE, 'person' satisfies ActMode);

/** The route may be used as a page: its data then belongs to the page. */
export const ForPages = () => SetMetadata(ACT_MODE, 'page' satisfies ActMode);

/** Closes one route to pages inside a controller that is otherwise open to them. */
export const NotForPages = () => SetMetadata(ACT_MODE, 'none');
