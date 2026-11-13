# Roadmap

Where Life Portal is, where it is going, and in what order. Updated 2026-11-11. Product
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

No public launch is planned soon; the focus until then is polish. These gaps are a gate for the
day launch is scheduled, not the next step. Found in a review on 2026-11-11 by reading the code:

- **No password reset and no email.** Auth has register, login, refresh, change-password and
  logout only; a person who forgets their password is locked out for good.
- **No rate limits** on login, register or anything else.
- **No error monitoring** in production.
- **`apps/api-e2e` is still the generated "Hello API" test**, so nothing boots the real app
  against a database automatically.

Done since the review (2026-11-11): CI runs `npm run check` on every push to main
(`.github/workflows/check.yml`), and the access module, friend profiles and diaries, people
search, connection actions and money widget sharing have their own tests.

- **Account deletion and data export.** Health data is a GDPR special category. Every module
  doc lists what deletion must remove.
- **Real-device checks** of push, messages and swiping on an iPhone.
- **Tier 0 limits:** Atlas M0 has 512 MB; Vercel Hobby does not allow commercial use, and Render
  free is kept awake by a cron job.
- **Image moderation** (automated scanning) before public photos reach strangers at scale. The
  For You feed (018) does exactly that, so its `forYou` flag stays off for production until then.
- **Camera video plays only where the recording browser's codec does** (no transcoding yet).
- **The money modules are built for one person** (the seeded loan, ESPP plan and EPAM boards).
  Decide whether they stay owner-only behind a flag or become a product for everyone, before
  strangers see them.

## Where we want to be (next, in order)

1. ~~**Photos in posts.**~~ Done in 014: R2 with signed links, EXIF stripped on the phone,
   plus 30-second camera video and text-only posts.
2. **AI meal guess from a photo** (next: a button on the new post page's New food card), behind a feature flag that stays off until there are API
   keys. One provider interface, so adding the key is the only step left. Every guess is stored
   as a labelled estimate with its basis until the person confirms it (principle 6). Paid
   feature; the MCP connectors remain the free alternative.
3. **Explore and search built around food.** Filter posts by macros ("600 kcal dinners, 40g+
   protein"). Diet tags (vegan, keto, high-protein) are computed from the facts, never stored
   by hand (the first six, high-protein to high-fibre, exist since #8: `postTopics()`). Image moderation (CSAM scanning, nudity) must exist before public images.
4. **Groups and challenges.** Streaks, protein-target days, logging streaks, staying within
   calories. A challenge sees only a computed score, never the diary. Group chat reuses the
   messages module (conversations already have a members shape).
5. **Training and sports.** A module for sessions, sets and later GPS tracks, stored as events.
   Personal records, distance and ranks are computed on read. Leaderboards are opt-in and
   friends- or group-only by default. Imported workouts count as "verified", manual ones as
   "self-reported". Moved ahead of diet plans (2026-11-12), because programs (diet, training or
   both) need both halves. Phases: 1 exercise catalogue and logging (spec 020, complete 2026-11-12, behind the
   `training` flag), 2 workout plans: ready-made and own plans, starting a workout from a plan
   (spec 023, complete 2026-11-12), 3 training UI overhaul: colour by muscle group and plan, a weekly
   header, progress in the open workout, History by week (spec 024, complete 2026-11-12), workout flow: duplicate days, done/current
   exercises, rest per exercise, supersets, a pinned workout bar (spec 025, complete 2026-11-12),
   4 strength ranks and levels: **levels done** (#5a, `trainingLevels` flag); **strength ranks
   built** (#5b, `trainingRanks` flag, off for production; 287 exercises in frozen standards
   `v1`, ratio-based ones labelled provisional): personal,
   per exercise, against fixed versioned standards, never other members' data; current (90 days)
   and highest-ever ranks. v1 frozen 2026-11-13; production rollout waits on a separate go-ahead. *In progress (#12):*
   opt-in **monthly** tournaments (calendar-month seasons) among similarly ranked members. Built
   behind `tournaments`: UTC calendar, men's and women's categories with explicit consent,
   lock-time snapshot and groups, scoring (owner formula), live standings and frozen results,
   withdrawal, voiding, retention and reminders. Production rollout waits on review
   (`docs/modules/tournaments.md`).
   *Later, not built:* ranks and levels may become a modest credibility signal for creators'
   training content in For You, with relevance and quality staying primary, no suppression of
   beginners, imported ("verified") workouts weighted over self-reported ones, and resistance to
   gamed logs.
   5 workout posts and friend leaderboards, then programs, with paid programs last.
6. **Video through a service.** 014 records 30-second clips in the app and stores them as-is.
   Next: transcoding through Mux or Cloudflare Stream so every clip plays everywhere, library
   videos and 60 seconds. No reels scroller until people make video on their own.
7. **Native apps.** Wrap the web app with Capacitor and add HealthKit and background location.
   Background GPS (skiing, rides) is the one thing a PWA cannot do.

Also wanted, unscheduled: quote reposts (a repost with your own text), a public web page for public posts (017 gives link previews; opening one still needs sign-in), a native Instagram Stories sticker with a link back (needs the Capacitor app), recipes (steps and time on combination posts), message requests from
non-friends, reactions, typing indicators, stories (the inbox's friend row is ready for rings).

## Architecture by tier

### Tier 0: now, under ~1k users, about $0/month

Provider-by-provider costs, free tiers and the one-cloud-vs-mix question: `docs/hosting-cost-comparison.md`.

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
