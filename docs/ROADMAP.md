# Roadmap

Where Life Portal is, where it is going, and in what order. Updated 2026-11-22. The admin sees this roadmap in the app (Menu → Roadmap); its content lives in
`apps/api/src/roadmap/roadmap.data.ts`, which must change with this file. Product
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
| **Food** | Nutrition tracking, food profile and activity targets, Apple Health sync with resumable batches, AI assistant connectors (MCP with OAuth: ChatGPT, Claude), brands with logos (public and own) and brand filters, logging several foods for several meals in one go, suggestions from recent meals, collapsible meals | 001, 004, 010, 011 |
| **Training** | Exercise catalogue and logging, ready-made and own plans, the workout flow (rest, supersets, pinned bar), levels. Built and off for production: strength ranks, monthly tournaments, sharing and copying workouts, plans and exercises | 020, 023–025, 036 |
| **Social** | Friends, shared widgets, shared daily diary, posts (text, photos, 30 s camera video, food, training) with likes, comments and Share, a camera-first new post page, a Share sheet with chats, reposts and app buttons, Story share images and public link previews, Home feed, link-only posts (sent to particular people, on no wall) | 006–009, 014–017 |
| **Offline** | Training, food and social writes work with no connection and sync later; conflicts are shown, never merged silently; sync health counters for the admin | 027–035 |
| **Look and feel** | Colour themes as data with an admin page (v0 and Crisp), glass surfaces, a floating tab bar that shrinks on scroll, resizable Home widgets, the Food page redesign | 037 |
| **Platform** | Onboarding and setup, feature flags per cohort and user, installable PWA, push notifications with Activity and icon badge, direct messages, tabs that stay alive with swipe navigation, CI running the checks on every push, its own address (`lifeportal.one`) with email sending, password reset and email verification, an error log, download-your-data and account deletion (038), photo moderation with a review queue and account suspension (039; the automatic check waits for its key) | 003, 005, 012, 013 |

**Infrastructure is Tier 0** (about $0/month): Vercel Hobby, Render free (kept awake by a cron
job), MongoDB Atlas M0.

**How the last weeks went:** almost all work since 2026-11-11 was polish and sub-features that
this list did not name (offline, themes, brands, widgets, sharing), in line with "the focus
until then is polish". Of the numbered steps below, only Training moved.

**2026-11-22:** the app got its own address and email, and the two things that stood between
it and open registration were built: leaving with your data (038) and photo moderation (039).
Terms, a privacy policy and community rules followed the same day. What remains before the
invite code goes is the owner's: a test on a phone with a second
account. The photo check is switched on and a lawyer has read the documents.

**Registration opened 2026-11-22.** What a stranger meets now is the next concern: with no
friends and For You still off, their Home feed is empty. Pages (the app's own, with content)
and switching For You on are what fix that.

**Still open from opening up:** sign-up says when an email address is already registered, which
lets anyone test whether a person has an account; make that answer generic. The free hosting
plans (the server sleeps; Vercel Hobby is not for commercial use) need replacing before the app
is promoted.

### Known gaps to close before a public launch

No public launch is planned soon. These are a gate for the day launch is scheduled. The first
three have moved into the numbered steps, because friends already use the app.

- ~~**Account deletion and data export.**~~ Done 2026-11-22 (spec 038, `docs/modules/account.md`):
  Menu → Your data and account.
- **Terms, privacy policy and community rules:** written 2026-11-22 as pages in the app
  (`/terms`, `/privacy`, `/rules`), with an explicit tick for health information at sign-up.
  The operator is named as the owner's individual-entrepreneur registration
  (`apps/web/src/lib/brand.ts`); change it when a company takes over. A lawyer read the three pages on
  2026-11-22; have them read again before payments or a company change.
- **`apps/api-e2e` is still the generated "Hello API" test.** `npm run test:integration` boots
  the real app against a database, but needs one supplied; nothing runs it automatically.
- **Real-device checks** of push, messages and swiping on an iPhone.
- **Tier 0 limits:** Atlas M0 has 512 MB; Vercel Hobby does not allow commercial use, and Render
  free is kept awake by a cron job.
- **Image moderation:** built 2026-11-22 (spec 039, `docs/modules/moderation.md`): photos others
  can see are checked before they are shown, reports hide a post, the owner reviews and can
  suspend an account. **Owner's steps:** set `IMAGE_CHECK_PROVIDER` and `OPENAI_API_KEY` on the
  API host (done 2026-11-22: the check is on), and decide on a service that matches known
  child-abuse images, which this check does not do. `forYou` stays off for production until
  the check is switched on.
- **Camera video plays only where the recording browser's codec does** (no transcoding yet).
- **The money modules are built for one person** (the seeded loan, ESPP plan and EPAM boards).
  Decide whether they stay owner-only behind a flag or become a product for everyone, before
  strangers see them.
- **Brand logos** are other companies' trademarks, uploaded by the admin. Check their use with
  an adviser before the app is commercial.

### Open decisions

- **Should a shared link open without an account?** Today every post needs sign-in, link-only
  ones included. A public page would make sharing to WhatsApp useful to people who have not
  joined, and is a deliberate privacy step.
- **AI meal photos or more polish first?** The AI step is the main paid feature and has not been
  started.
- **Money modules:** owner-only for good, or a product.
- **The name and its trademark.** "Life Portal" is kept (see DECISIONS, 2026-11-22). To do: file
  in the EU and Georgia once the app shows its worth, and get a specialist's view before
  marketing in the US, where two unrelated companies hold or have applied for the name.
- ~~**When does the invite code go?**~~ Gone 2026-11-22: registration is open to anyone, after
  the owner tested sign-up, reports, removal, suspension, export and deletion on a phone. Setting
  `REGISTRATION_INVITE_CODE` again closes it.
- **Where does the AI mark show?** The owner's proposal: on the page only, since anyone who opens
  it sees it is AI-managed. The recommendation: a small mark beside the page's name wherever it
  appears, because most people meet a post in the feed and never open the page.
- **What may a promoted post target?** The business model rules out ads targeted on health data,
  and in this app almost everything a person does is health data. Promotion would have to work
  from language, country and what a person chose to follow, not from their diary.

## Where we want to be (next, in order)

1. ~~**Photos in posts.**~~ Done in 014: R2 with signed links, EXIF stripped on the phone,
   plus 30-second camera video and text-only posts.
2. ~~**Safety net for the people already using it.**~~ Done and switched on (2026-11-22).
   - **Done:** password reset by email, email verification, sign-in rate limits, a security log,
     per-device sessions and Continue with Google (#27, #28, 2026-11-15); an error log for the
     admin, on the server and on people's pages (2026-11-22, `docs/modules/errors.md`).
   - **Switched on 2026-11-22:** the app has its own address, `https://lifeportal.one`. Email is
     sent through Resend from that domain, so password reset and email verification work in
     production (checked on the live address); mail to the domain is forwarded by ImprovMX.
   - **Ready for strangers (2026-11-22):** people can download their data and delete their
     account (038); photos others can see are checked before they are shown, reports hide a
     post, and the owner has a review queue and can suspend an account (039). The photo check is
     switched on, and terms, privacy policy and rules are written and read by a lawyer. What is
     left is the owner's test on a phone with a second account.
3. **Numbers: know how the app is used.** Asked for 2026-11-22, the day registration opened.
   Nothing measures use today beyond the For You measurement (off), sync health and the error
   log, so there is no way to tell whether a change helped.
   - ~~**First, from what is already stored.**~~ Done 2026-11-22 (Menu → Numbers,
     `docs/modules/usage.md`): accounts, new accounts, people active today and over 7 and 30
     days, how many new accounts did anything, who came back after 1, 7 and 30 days, and how
     many logged food, trained, weighed in, posted or engaged, with a table per day. Computed
     on read; totals only.
   - **Then where sign-up loses people and where visitors come from:** a counter for the public
     pages with no cookie and no person, our own (like sync health) or a self-hosted tool such
     as Plausible or Umami. The privacy policy says there is no third-party analytics; using an
     outside service changes that page and is a decision, not a detail.
   - **Never:** a per-person history of what someone looked at, health information in
     analytics, or third-party trackers with cookies.
4. ~~**Switch on what is built.**~~ Done 2026-11-22: the owner switched every feature on for
   everyone, except the money, shares, debts, items to sell, personal plans and projects modules,
   which stay the owner's own.
5. **Your portal.** Make "portal" a real thing in the app, so "check my portal" is literally
   true (decided 2026-11-22; it is what the name promises). A person's profile becomes their
   portal: the same widgets and modules they see themselves, shown to others as far as they
   choose.
   - **One page for a life:** food and training today; later whatever else the person tracks.
     A friend who opens it finds how that person eats and trains, not only their posts.
   - **The person decides, per module:** private, friends or public. Private stays the default
     for everything. Sharing by module exists since 006 (`moduleVisibility`, shared widgets and
     the shared diary); this step turns it into the centre of the profile and names it.
   - **Money is the person's choice too,** later and with a plain warning: it is the kind of
     information scams are built on, and once public it cannot be taken back.
   - **Self-declared, and shown as such.** What a portal says is what its owner entered. Nothing
     is presented as checked unless it was (imported workouts are the one "verified" kind).
   - **The words follow:** "Profile" becomes "Portal" in the tab bar, the menu, sharing and
     links, and a portal has an address a person can send.
6. **Pages.** An account that is not a person: a page that one or more people manage, which
   publishes content and nothing else. Decided 2026-11-20; details to be specified.
   - **Content only.** A page cannot log food, workouts or weight, and stays out of ranks,
     tournaments, leaderboards and friend suggestions. It is not a person.
   - **The app's own pages come first** (kitchen, training, challenges), managed by the owner:
     meal ideas that can be saved, plans that can be copied, a weekly challenge. They are what a
     new person sees instead of an empty feed. Three to five, one or two posts a day each.
   - **A page can be marked as AI-managed** by whoever runs it. On such a page, something a
     human did is marked as human.
   - **Never fake people.** No invented meals "eaten today", no invented records, no pages
     talking to each other to look like a crowd. Undisclosed bot accounts deceive the people the
     app is for, are noticed quickly in a small network, and can fall under consumer-protection
     rules on fake engagement.
   - **Later uses of the same thing:** restaurants with verified menus, gyms and brands with
     challenges, coaches with plans (see the business model).
7. **Assistant tools for pages, training and challenges.** The connector (MCP) handles food
   only. Add tools to act as a page: read the public and friends feeds, create a post, comment,
   react. Then the same for training, and for challenges once they exist. A tool acts as one
   named page, never as the person behind it, and what it did is visible in the page's history.
   This is what lets a scheduled job run an AI-managed page; its drafts are approved by the
   owner at first.
8. **AI meal guess from a photo** (a button on the new post page's New food card), behind a
   feature flag that stays off until there are API keys. One provider interface, so adding the
   key is the only step left. Every guess is stored as a labelled estimate with its basis until
   the person confirms it (principle 6). Paid feature; the MCP connectors remain the free
   alternative.
9. **Groups and challenges.** Streaks, protein-target days, logging streaks, staying within
   calories. A challenge sees only a computed score, never the diary. Group chat reuses the
   messages module (conversations already have a members shape). Ahead of search (2026-11-20):
   a small group of friends will use a challenge before it needs search.
10. **Plans.** One thing a person or a page can publish: a diet plan, a workout plan, or both,
   with the creator's notes and advice. Others copy it into their own foods and plans (copying
   training plans exists since 036). Free first; paid plans arrive with payments (step 13).
11. **The desktop version.** The app is designed for a phone and merely works on a wide screen.
    Making it good there is a long piece of work, done in parts (asked for 2026-11-22):
    - **Navigation in the header** instead of the bottom tabs, which belong to a thumb.
    - **A search bar in the header,** once search exists (the next step).
    - **Side columns** beside the feed and the modules: things worth seeing at a glance (today's
      numbers, friends, suggestions), and later a place for clearly labelled, controlled
      promotion (see payments and promoted posts).
    - **Layouts that use the width:** the Food day, a workout, a post and its comments side by
      side, tables where a phone has cards, hover and keyboard where a phone has long-press.
    - **Unchanged on a phone.** Nothing here may make the phone version worse; the wide layout is
      an addition, switched by width.
12. **Explore and search built around food.** Filter posts by macros ("600 kcal dinners, 40g+
   protein"). Diet tags (vegan, keto, high-protein) are computed from the facts, never stored
   by hand (the first six, high-protein to high-fibre, exist since #8: `postTopics()`). Image
   moderation exists since 039; matching known abuse images is still open.
13. **Payments, promoted posts and paid plans.** Anyone can pay to promote a post, or give a
    budget to several posts and let the system decide where it goes, the way the large networks
    do. It needs payments, a "Sponsored" label, a review of what is promoted, and enough people
    for promotion to mean anything; it can be built before launch and switched on later. Paid
    plans and the creator commission use the same payments.
14. **Training and sports, the rest.** Stored as events; personal records, distance and ranks
    are computed on read. Leaderboards are opt-in and friends- or group-only by default. Imported
    workouts count as "verified", manual ones as "self-reported".
    - **Done:** catalogue and logging (020), plans (023), the training UI and workout flow
      (024, 025), levels (#5a).
    - **Built, off for production** (step 4 turns them on): strength ranks (#5b, 287 exercises in
      frozen standards `v1`, personal and against fixed standards, never other members' data);
      monthly tournaments (#12, see `docs/modules/tournaments.md`); sharing and copying workouts,
      plans and exercises (036).
    - **Still to come:** friend leaderboards. GPS tracks need the native app (step 16).
    - **Later, not built:** ranks and levels may become a modest credibility signal for creators'
      training content in For You, with relevance and quality staying primary, no suppression of
      beginners, imported workouts weighted over self-reported ones, and resistance to gamed logs.
15. **Video through a service.** 014 records 30-second clips in the app and stores them as-is.
    Next: transcoding through Mux or Cloudflare Stream so every clip plays everywhere, library
    videos and 60 seconds. No reels scroller until people make video on their own.
16. **Native apps.** Wrap the web app with Capacitor and add HealthKit and background location.
    Background GPS (skiing, rides) is the one thing a PWA cannot do.

Also wanted, unscheduled: more themes, real refraction for the glass (tried 2026-11-18: it works
in Safari only for small elements and looked poor; shelved), quote reposts (a repost with your
own text), a native Instagram Stories sticker with a link back (needs the Capacitor app), recipes
(steps and time on combination posts), message requests from non-friends, reactions, typing
indicators, stories (the inbox's friend row is ready for rings).

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

**Ruled out:** ads targeted on health data, and selling data. Promoted posts (step 13) must
respect the first; see "Open decisions".

Rough numbers: at 100k monthly users infrastructure is about a cent per user; 4% paying $5 is
about $20k/month. Stripe on the web costs about 3%; Apple takes 15–30% in a native app, so web
sign-up stays available.
