# Quickstart: verify 014

Prereqs: local Mongo + built API with `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; bucket CORS allows the web origin.

1. Header: + left, LifePortal centred, no name.
2. Text post from + with Friends audience; friend sees it, stranger does not.
3. Add food from + (today's meal); post matches the Food-page share.
4. Upload a JPEG with GPS EXIF; download the stored object; no EXIF.
5. Signed URL works; the same URL after expiry gives 403; a stranger's `GET /posts/:id` is 404.
6. Retry Share with the same requestId → same post id.
7. Delete the post → objects 404 in R2.
8. Pending upload older than 24 h is removed by the cleanup.
9. Camera (phone): tap = photo, hold = video, ring fills, stops at 30 s.
