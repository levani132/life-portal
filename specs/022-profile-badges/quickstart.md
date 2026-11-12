# Quickstart: validating profile badges

## Setup

Start the database and the app:

```bash
docker run -d --name lp-mongo-022 -p 27022:27017 mongo:7
MONGODB_URI=mongodb://127.0.0.1:27022/lp-badges JWT_SECRET=$(openssl rand -hex 32) \
  npm run seed && npm run dev
```

Use two accounts with `social`, `nutrition` and `training` on. These are the defaults for
developer and internal accounts.

## Automated coverage (`npm run check`)

- **Domain: `badges.spec.ts`.**
  - Streaks across `dayStartHour` days.
  - Today and the current week never breaking a run.
  - Cheat weekdays skipped.
  - Days without a target.
  - The ±10% boundary in integers.
  - Tiers reached in an earlier run, and `reachedOn` from the earliest run.
  - Consistency with 1 vs 2 sessions in a week.
  - `countMilestones` dates.
- **API: `badges.service.spec.ts`.**
  - Idempotent awards under two concurrent evaluations: one row, one notification.
  - Awards survive deleted meals and unfriending.
  - Inaccessible badges are hidden but not deleted.
  - Equipping an unearned badge returns a 400.
  - The people route returns only equipped, accessible badges. It never returns progress.
  - A blocked pair gets a 404.
- **Notifications:** `shouldNotify` allows self only for `selfAllowed` types.

## Manual scenarios

1. **Backfill.** Seed 8 consecutive food days, one post and one accepted friend, then open
   Profile. "Set up", "First post", "First friend", "Early member" and "7-day logging streak"
   show as earned. Each is dated when it was reached, not today, and "30-day" shows 8/30. One
   notification says "You earned 5 badges".
2. **Live award.** Log the meal that makes a 7-day streak. The notification arrives within a
   minute and links to `/profile?badge=loggingStreak`, which highlights the badge.
3. **Equip.** Equip three badges and reorder them. The header shows them in that order. Equipping
   a fourth asks which one to replace.
4. **Tier upgrade.** Equip the logging streak at 7, then reach 30. The header shows 30 with no
   action.
5. **Permanence.** Delete the meals that made the streak, and unfriend the friend. Every badge is
   still earned.
6. **Other viewer.** From account B, open A's profile. B sees only A's equipped badges, and
   tapping one shows its name, rule and date. The network response contains no progress.
7. **Access.** Turn nutrition off for A in Feature access. Food badges disappear from A's
   collection, header and B's view. Turn it back on and they return with their original dates.
8. **View as.** "View as stranger" shows the same equipped row as B sees.
9. **Training.** Finish two workouts in each of four weeks. "First workout" and "4-week
   consistency" are earned, and an open workout does not count.
10. **Phone.** At 375 px, light and dark mode, the header row does not wrap the name, and the
    collection does not scroll sideways.
