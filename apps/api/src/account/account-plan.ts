/**
 * What happens to each collection when an account is deleted or exported (spec 038).
 *
 * Every collection the API declares must be listed here: `account-plan.spec.ts` reads the source
 * for `collection: '…'` and fails when one is missing, so a new module cannot be forgotten.
 *
 * - `owned`: rows that belong to one account, found by `field` (default `userId`). Deleted with
 *   the account. Exported unless `export: false` (sign-in state and other machinery).
 * - `custom`: handled by name in `AccountService`, because the account is one of several people
 *   in a row, or the row is the account itself.
 * - `kept`: holds no person, or nothing of this one. `why` says which.
 */
export type CollectionRule =
  | { kind: 'owned'; field?: string; export?: false }
  | { kind: 'custom'; how: string }
  | { kind: 'kept'; why: string };

const owned: CollectionRule = { kind: 'owned' };
/** Owned, but machinery: sessions, tokens, caches. Deleted, not exported. */
const machinery: CollectionRule = { kind: 'owned', export: false };
const noPerson = (why: string): CollectionRule => ({ kind: 'kept', why });

export const ACCOUNT_PLAN: Record<string, CollectionRule> = {
  // ---- the account and how it signs in
  users: { kind: 'custom', how: 'The account itself: deleted last, so an interrupted deletion can be run again.' },
  auth_sessions: machinery,
  auth_email_tokens: machinery,
  oauth_flows: machinery,
  user_identities: owned,
  security_events: owned,
  auth_rate_limits: noPerson('Counters keyed by a hash; they expire within the hour.'),
  ingest_tokens: machinery,
  mcp_oauth_credentials: machinery,
  mcp_oauth_clients: noPerson('Assistant apps that registered, not accounts.'),
  idempotency_keys: machinery,
  push_devices: machinery,
  notification_preferences: owned,
  notification_deliveries: { kind: 'owned', field: 'recipientId', export: false },
  user_settings: owned,

  // ---- money, work and plans
  loans: owned,
  loan_payments: owned,
  repayment_plans: owned,
  cash_balances: owned,
  income_sources: owned,
  expenses: owned,
  sellable_items: owned,
  stock_lots: owned,
  stock_targets: owned,
  espp_plans: owned,
  spend_payments: owned,
  personal_plans: owned,
  boards: owned,
  board_tasks: owned,
  board_notes: owned,
  board_people: owned,
  board_contributions: owned,
  board_wins: owned,
  stock_quotes: noPerson('Market prices.'),
  stock_price_history: noPerson('Market prices.'),
  stock_fundamentals: noPerson('Market data.'),
  fx_rate_history: noPerson('Exchange rates.'),

  // ---- food
  foods: owned,
  food_brands: owned,
  meal_entries: owned,
  saved_meals: owned,
  cheat_meals: owned,
  weigh_ins: owned,
  nutrition_profiles: owned,
  nutrition_health: owned,
  nutrition_health_days: owned,
  health_shortcut_settings: noPerson('One row of app configuration set by the developer.'),

  // ---- training
  exercises: owned,
  training_machines: owned,
  training_profiles: owned,
  training_plans: owned,
  workout_sessions: owned,
  workout_exercises: owned,
  workout_sets: owned,
  tournament_entries: owned,
  tournament_groups: { kind: 'custom', how: 'Shared by its members: the account and its frozen result are taken out of each group.' },
  tournament_locks: noPerson('Which season was formed, per exercise.'),
  tournament_reminders: noPerson('Which reminder went out, per season.'),
  badge_awards: owned,
  badge_selections: owned,

  // ---- social
  social_profiles: owned,
  social_connections: { kind: 'custom', how: 'A row joins two people: every row naming the account is deleted.' },
  page_assistant_actions: { kind: 'owned', field: 'pageId', export: false },
  page_scheduled_actions: { kind: 'owned', field: 'pageId', export: false },
  assistant_settings: noPerson('One row of app configuration: the assistant’s default caps.'),
  follows: { kind: 'custom', how: 'A row joins a follower and a page: every row naming the account, as either, is deleted.' },
  food_posts: { kind: 'custom', how: 'Own posts and reposts are deleted, with other people’s reposts, likes, comments and reports of them.' },
  post_likes: owned,
  post_comments: owned,
  post_reports: owned,
  post_media: owned,
  feed_feedback: owned,
  feed_preferences: owned,
  for_you_sessions: machinery,
  feed_metric_keys: noPerson('Keyed by a keyed hash of account and day, unreadable without the server secret; gone within 8 days.'),
  feed_metrics_daily: noPerson('Daily totals with no account.'),
  conversations: { kind: 'custom', how: 'A conversation has two members: each one the account is in is deleted with its messages.' },
  messages: { kind: 'custom', how: 'Deleted with their conversation. The export holds the ones the account sent.' },

  // ---- the app
  feature_policies: noPerson('Feature switches per group.'),
  themes: noPerson('The app’s colour themes.'),
  theme_settings: noPerson('Which theme is active.'),
  error_events: noPerson('Scrubbed error counts.'),
  sync_health_daily: noPerson('Daily counters with no account.'),
  dev_mail: noPerson('Development only; never written in production.'),
};

/** Collections whose rows may point at stored files that go with the account. */
export const FILE_COLLECTIONS = ['post_media', 'foods', 'food_brands', 'exercises', 'training_machines', 'training_plans', 'social_profiles', 'food_posts'] as const;
