# Roadmap

Where Life Portal is, where it is going, and in what order. Updated 2026-11-05. Product
direction comes from the owner; the order and the architecture tiers are recommendations agreed
in conversation, not commitments. Costs are rough late-2026 list prices, order of magnitude only.

**The direction in one line:** a private-by-default life dashboard that grows into a
Strava-like social app for food, training and sports, where calories eaten and burned live on
the same day. The core stays free; AI is the paid part.

## Where we are (built and live)

| Area | What exists | Specs |
|---|---|---|
| **Money** | Loans with payoff scenarios, free-money cash flow, items to sell, shares and the ESPP plan, spending from bank messages (Shortcut ingest), multi-currency with daily FX history | 002 |
| **Work and life** | EPAM boards, side projects, personal plans | — |
| **Food** | Nutrition tracking, food profile and activity targets, Apple Health sync with resumable batches, AI assistant connectors (MCP with OAuth: ChatGPT, Claude) | 001, 004, 010, 011 |
| **Social** | Friends, shared widgets, shared daily diary, posts (text, photos, 30 s camera video, food) with likes, comments and Share, a camera-first new post page that can create and log a food, a Share sheet with chats, reposts, Save foods and app buttons, Story share images and public link previews, Home feed | 006–009, 014–017 |
| **Platform** | Onboarding and setup, feature flags per cohort and user, installable PWA, push notifications with Activity and icon badge, direct messages, tabs that stay alive with swipe navigation | 003, 005, 012, 013 |

**Infrastructure is Tier 0** (about $0/month): Vercel Hobby, Render free (kept awake by a cron
job), MongoDB Atlas M0.

### Known gaps to close before a public launch

- **Account deletion and data export.** Health data is a GDPR special category. Every module
  doc lists what deletion must remove.
- **Real-device checks** of push, messages and swiping on an iPhone.
- **Tier 0 limits:** Atlas M0 has 512 MB; Vercel Hobby does not allow commercial use.
- **Image moderation** (automated scanning) before public photos reach strangers at scale.
- **Camera video plays only where the recording browser's codec does** (no transcoding yet).

## Where we want to be (next, in order)

1. ~~**Photos in posts.**~~ Done in 014: R2 with signed links, EXIF stripped on the phone,
   plus 30-second camera video and text-only posts.
2. **AI meal guess from a photo** (next: a button on the new post page's New food card), behind a feature flag that stays off until there are API
   keys. One provider interface, so adding the key is the only step left. Every guess is stored
   as a labelled estimate with its basis until the person confirms it (principle 6). Paid
   feature; the MCP connectors remain the free alternative.
3. **Explore and search built around food.** Filter posts by macros ("600 kcal dinners, 40g+
   protein"). Diet tags (vegan, keto, high-protein) are computed from the facts, never stored
   by hand. Image moderation (CSAM scanning, nudity) must exist before public images.
4. **Groups and challenges.** Streaks, protein-target days, logging streaks, staying within
   calories. A challenge sees only a computed score, never the diary. Group chat reuses the
   messages module (conversations already have a members shape).
5. **Training and sports.** A module for sessions, sets and later GPS tracks, stored as events.
   Personal records, distance and ranks are computed on read. Leaderboards are opt-in and
   friends- or group-only by default. Imported workouts count as "verified", manual ones as
   "self-reported".
6. **Video through a service.** 014 records 30-second clips in the app and stores them as-is.
   Next: transcoding through Mux or Cloudflare Stream so every clip plays everywhere, library
   videos and 60 seconds. No reels scroller until people make video on their own.
7. **Native apps.** Wrap the web app with Capacitor and add HealthKit and background location.
   Background GPS (skiing, rides) is the one thing a PWA cannot do.

Also wanted, unscheduled: quote reposts (a repost with your own text), a public web page for public posts (017 gives link previews; opening one still needs sign-in), a native Instagram Stories sticker with a link back (needs the Capacitor app), recipes (steps and time on combination posts), message requests from
non-friends, reactions, typing indicators, stories (the inbox's friend row is ready for rings).

## Architecture by tier

### Tier 0: now, under ~1k users, about $0/month

Vercel Hobby, Render free, Atlas M0. Add Cloudflare R2's free tier (10 GB, free downloads) for
photos. A soft-launch step costs about $40–70/month: Render Starter, Atlas Flex, Vercel Pro.

### Tier 1: 10k–100k active users, about $400–1,500/month before AI

| Piece | Choice | Rough cost |
|---|---|---|
| Web | Vercel Pro | $20–150 |
| API | 2–6 stateless NestJS instances behind a load balancer | $100–300 |
| Realtime | Socket.IO in Nest with Redis fan-out; the messages `sync` payload stays the contract | included |
| Redis | Cache, rate limits, fan-out, BullMQ queues | $20–100 |
| Workers | BullMQ: image resizing, notifications, feed building, search indexing, Finnhub/FX jobs | $25–100 |
| Database | Atlas M10 → M30 | $60–400 |
| Search | Atlas Search | included or small |
| Media | R2 + CDN + image resizing (R2 because downloads are free) | $20–100 |
| Email, errors, logs | Resend or Postmark, Sentry, Better Stack | $50–100 |

AI photo logging is the biggest variable: about 1–2 cents a photo, so 10k photos a day is about
$3–6k a month. Rate-limit it or keep it in the paid plan.

### Tier 2: millions of users, about $15k–80k/month (much of the range is video)

- Containers on one cloud, in the same region as Atlas. Separate services: core API, feed,
  chat gateway, media, ingest. The module-per-widget structure already splits this way.
- An event stream (Mongo change streams or an outbox, into Kafka/MSK or SQS/EventBridge) that
  search, feeds, notifications and analytics consume.
- Mongo sharded by `userId`; messages sharded by conversation.
- Feeds precomputed in Redis on write, built on read for very popular accounts.
- Dedicated search nodes or OpenSearch, plus vector search for "meals like this one".
- A separate analytics warehouse (ClickHouse or BigQuery).
- WAF, KMS-managed keys, field-level encryption for health data, and a data-residency decision.

**No SQL database at any tier.** Stripe is the record for billing and the warehouse handles
analytics.

### Decisions that keep the next tier cheap

- Images go browser → bucket via pre-signed URLs.
- Add Redis and BullMQ early (Upstash has a free tier), so background work has a home.
- Keep the API stateless.
- Give each new social write a domain event, so search and notifications can listen later.

## Business model

Free core: tracking, social, messages and connectors stay free. Paid:

1. **Plus subscription** (about $4–8/month, regional pricing for Georgia): AI photo logging, an
   AI coach, deeper trends, longer and HD video, more storage. Priced at 3–5× its AI cost per
   user. Credit packs for occasional users.
2. **Company wellness:** per-seat team challenges.
3. **Sponsored challenges** from gyms, brands and ski resorts, labelled as sponsored.
4. **Verified restaurant menus:** restaurants pay to list dishes with checked nutrition.
5. **Coach marketplace, later:** paid programs, 10–20% commission.

**Ruled out:** ads targeted on health data, and selling data.

Rough numbers: at 100k monthly users infrastructure is about a cent per user; 4% paying $5 is
about $20k/month. Stripe on the web costs about 3%; Apple takes 15–30% in a native app, so web
sign-up stays available.
