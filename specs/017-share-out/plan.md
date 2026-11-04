# Plan: Sharing outside the app

**Spec**: [spec.md](spec.md)

## Design

- **Domain** (`libs/shared/domain/src/lib/posts.ts`): `canShareImage()`; `ringArcs()` (angles of the
  macro ring, shared by the canvas and the OG image); `shareTargets(url, text)` for app links.
- **API**: `PublicPostsController` (`GET /api/public/posts/:id/preview`, `@Public()`, no module
  guard, `no-store`) → `PostsService.publicPreview(id)`. Same live checks as `readable()` for an
  anonymous viewer: public audience, not deleted, not a repost, author access on.
- **Web**:
  - `lib/share-image.ts` draws the Story card on a canvas; the photo is loaded with
    `crossOrigin="anonymous"` (R2's CORS allows GET) and dropped if the canvas would be tainted.
  - `app/posts/[id]/layout.tsx` `generateMetadata()` fetches the preview server-side;
    `app/posts/[id]/opengraph-image.tsx` renders the card with `next/og`.
  - The Share sheet gains Save foods, the image actions and a Share to row.

## Constitution check

Bounded module (posts) ✓ · nothing persisted, image derived on demand ✓ · rules are pure and
tested ✓ · `@Public()` route is the explicit, audited exception and returns a fixed small shape ✓
