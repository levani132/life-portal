# Verification: 014 (2026-11-04)

Local API (built `dist`) against the real R2 bucket `life-portal`, local MongoDB, three test
accounts. Browser checks in the in-app browser at 375×812.

## Storage (direct)
- Signed PUT with a different size → 403; with a different type → 403; matching → 200.
- `HEAD` returns the stored size and type. Signed GET → 200; unsigned GET → 400. DELETE → 204.

## API (`e2e-media`)
- `GET /posts/media/config` → available, 10 items, 30 s.
- Ticket → signed upload 200. A post using a ticket that was never uploaded → 400 "Upload not finished".
- PNG refused; 45 s video refused; empty post → 400.
- Photo post 201 with one media item and no food kind. Same `requestId` retried → same post.
  The same upload on another request → 400.
- A friend reads it: signed URL, the photo downloads (byte-exact). No storage key in the response.
- Text-only post 201 with no items or media; import from it → 400; editing it to empty → 400.
- Both appear in a friend's feed. Deleting the photo post removes the object (HEAD 404).

## Browser
- Header: + on the left, LifePortal centred, no name.
- Composer opens full screen. Audience starts at the profile default. Add from Food → Foods → pick
  attaches a previewed food card. Typing enables Share. Text + food published from the composer and
  opened the new post.
- A library photo was re-encoded and shown with a progress ring; its upload failed with a CORS
  error because the bucket has no CORS rule yet. The tile showed retry, Share stayed disabled, and
  removing it re-enabled Share.
- A two-photo post (uploaded server-side) renders in the carousel with 1/2 and dots; swiping moves
  to 2/2.
- Camera screen renders (shutter, flip, hint). Capture itself was not testable: the in-app browser
  blocks camera access.

## Not verified
- Browser uploads to R2 (needs the bucket's CORS rule).
- Real-device camera photo and video recording, iOS keyboard behaviour of the composer, video playback.
