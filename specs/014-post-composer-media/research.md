# Research: 014 post composer and media

## R1 Upload path: presigned PUT straight to R2
- **Decision**: The API issues a presigned PUT (10 minutes, `content-type` and `content-length` signed) per file; the browser uploads with XHR for progress. The API never sees the bytes.
- **Why**: Render's free instance has little bandwidth and memory, and the roadmap fixed this rule ("browser → bucket").
- **Needs**: bucket CORS allowing `PUT` and `GET` from the web origins, with `content-type` header.
- **Rejected**: proxying through the API (bandwidth, 30 s request limits); multipart (files are small).

## R2 Signing library: `aws4fetch` 1.0.20
- **Decision**: `aws4fetch` (zero dependencies, SigV4, query signing). Imported only by `storage.service.ts`.
- **Rejected**: `@aws-sdk/client-s3` + presigner: ~100 transitive packages for four calls.

## R3 Reading: signed GET links, stable for an hour
- **Decision**: Every media URL in a post response is a presigned GET valid for 2 hours, signed with the time floored to the hour, so the URL is identical for an hour and the browser cache works.
- **Why**: Friends-only media must not be a public link (spec FR-006). A link leaked to a stranger dies within 2 hours (SC-004) and they can never get a new one, because links only come from read-checked post responses.

## R4 Metadata removal on the device
- **Decision**: Photos are decoded with `createImageBitmap` (orientation applied) and redrawn on a canvas at most 2048 px on the long edge, exported as JPEG 0.85. A canvas carries no EXIF, so GPS and camera data are gone. iOS hands HEIC library photos to the page as JPEG.
- **Video**: only in-app capture (`MediaRecorder`), which writes no location. Library videos are out of scope until server-side processing exists.
- **Trust**: the server cannot cheaply re-check bytes it never sees. A modified client could upload its own metadata, which only exposes that member's own data.

## R5 Camera
- `getUserMedia({video: {facingMode, 1280×720}, audio: true})`. Tap = still from the video frame; hold (>250 ms) = `MediaRecorder` with `video/mp4` when supported (iOS Safari, Chrome 126+), else WebM; 2.5 Mbps cap. 30 s ≈ 10 MB.
- Poster: the first frame of a recorded video is drawn to a JPEG and uploaded alongside it, so feeds show a still without loading the video.
- Fallback: `<input type=file accept="image/*,video/*" capture="environment">` when `getUserMedia` or `MediaRecorder` is missing or refused. A video from that fallback is accepted, since it was just captured by the system camera, which on iOS does not embed location.

## R6 Orphans and deletion
- Uploads are rows in `post_media` (pending → attached). An hourly cron deletes pending rows older than 24 h and their objects (skipped with `DISABLE_SCHEDULES`). Post delete and moderation delete objects without awaiting.

## R7 Display
- Carousel with CSS scroll snap (a sideways scroller, so the tab swipe leaves it alone). Height from the first item's aspect ratio, clamped 4:5 to 1.91:1.
- Videos: `muted playsinline loop preload="metadata"`, played while ≥ 60 % visible (IntersectionObserver); tap toggles sound.
