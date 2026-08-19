/**
 * Environment configuration. Every secret arrives via env and is validated at boot so a
 * misconfigured deploy fails loudly instead of half-working (constitution: Secrets).
 */
export interface AppConfig {
  /**
   * Resolved from `API_PORT`, falling back to `PORT`, then 3333.
   *
   * `API_PORT` exists because `PORT` is not API-specific: `next dev`/`next start` read it too,
   * so a single shared `PORT` makes whichever app starts second die with EADDRINUSE. The `PORT`
   * fallback is kept because managed hosts (Render, Railway, Fly) inject it and expect the
   * process to bind it — there only the API runs, so there is nothing to collide with.
   */
  port: number;
  mongoUri: string;
  jwtSecret: string;
  /**
   * Token lifetimes in **seconds**, not `ms`-style strings. `@nestjs/jwt` types `expiresIn`
   * as `number | StringValue`, and a plain `string` from env does not satisfy that union, so
   * seconds keep the config honest without a cast.
   */
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  /** When set, registration requires this code. Keeps a public deploy from being open. */
  registrationInviteCode?: string;
  corsOrigins: string[];
  finnhubApiKey?: string;
  /**
   * Sent as `User-Agent` on every Open Food Facts request.
   *
   * The API needs no key, but it does require a custom agent — a generic one risks being
   * treated as a bot and blocked. `OFF_USER_AGENT` overrides this outright; otherwise an
   * `OFF_CONTACT_EMAIL`, if set, becomes the contact in the default agent. No address is
   * hard-coded, so nothing personal ships in the repo.
   */
  offUserAgent: string;
  /** Skips the scheduled quote refresh — useful locally and in tests. */
  disableSchedules: boolean;
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive whole number of seconds, got "${value}".`);
  }
  return parsed;
}

/** See `AppConfig.offUserAgent`. Open Food Facts asks for `AppName/Version (contact)`. */
function openFoodFactsUserAgent(): string {
  const explicit = process.env['OFF_USER_AGENT']?.trim();
  if (explicit) return explicit;
  const contact = process.env['OFF_CONTACT_EMAIL']?.trim();
  return contact
    ? `LifePortal/1.0 (${contact})`
    : 'LifePortal/1.0 (self-hosted personal dashboard)';
}

function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

export function loadConfig(): AppConfig {
  const jwtSecret = required('JWT_SECRET', process.env['JWT_SECRET']);
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters. Generate one with `openssl rand -hex 32`.');
  }

  return {
    port: positiveInt('API_PORT', process.env['API_PORT'] ?? process.env['PORT'], 3333),
    mongoUri: required('MONGODB_URI', process.env['MONGODB_URI']),
    jwtSecret,
    accessTokenTtlSeconds: positiveInt('ACCESS_TOKEN_TTL_SECONDS', process.env['ACCESS_TOKEN_TTL_SECONDS'], 900),
    refreshTokenTtlSeconds: positiveInt('REFRESH_TOKEN_TTL_SECONDS', process.env['REFRESH_TOKEN_TTL_SECONDS'], 2_592_000),
    registrationInviteCode: process.env['REGISTRATION_INVITE_CODE']?.trim() || undefined,
    corsOrigins: (process.env['CORS_ORIGINS'] ?? 'http://localhost:4200,http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    finnhubApiKey: process.env['FINNHUB_API_KEY']?.trim() || undefined,
    offUserAgent: openFoodFactsUserAgent(),
    disableSchedules: process.env['DISABLE_SCHEDULES'] === 'true',
  };
}

export const CONFIG = 'APP_CONFIG';
