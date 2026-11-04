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
  /** The only account with developer privileges. Never assigned by registration. */
  developerUserId?: string;
  /** Canonical API origin enabling the MCP OAuth server. */
  mcpOAuthIssuer?: string;
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
  /**
   * Web Push signing keys. All three or none: absent means the notifications feature is
   * hidden (graceful degradation); a partial set is a misconfiguration and refuses to boot.
   */
  push?: { publicKey: string; privateKey: string; subject: string };
  /**
   * S3-compatible object storage (Cloudflare R2) for post photos and videos. All four or none:
   * absent hides media in posts; a partial set refuses to boot.
   */
  storage?: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };
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

function oauthIssuer(): string | undefined {
  const value = process.env['MCP_OAUTH_ISSUER']?.trim();
  if (!value) return undefined;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('MCP_OAUTH_ISSUER must be an HTTPS origin (HTTP loopback is allowed for development).');
  }
  return url.origin;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** See `AppConfig.push`. Exported for its unit test. */
export function pushConfig(env: NodeJS.ProcessEnv): AppConfig['push'] {
  const values = {
    VAPID_PUBLIC_KEY: env['VAPID_PUBLIC_KEY']?.trim() || '',
    VAPID_PRIVATE_KEY: env['VAPID_PRIVATE_KEY']?.trim() || '',
    VAPID_SUBJECT: env['VAPID_SUBJECT']?.trim() || '',
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length === 3) return undefined;
  if (missing.length) {
    throw new Error(`Push notifications need all three VAPID variables; missing ${missing.join(', ')}.`);
  }
  if (!BASE64URL.test(values.VAPID_PUBLIC_KEY) || !BASE64URL.test(values.VAPID_PRIVATE_KEY)) {
    throw new Error('VAPID keys must be base64url. Generate them with `npx web-push generate-vapid-keys`.');
  }
  if (!/^(mailto:|https:\/\/)/.test(values.VAPID_SUBJECT)) {
    throw new Error('VAPID_SUBJECT must start with mailto: or https://.');
  }
  return {
    publicKey: values.VAPID_PUBLIC_KEY,
    privateKey: values.VAPID_PRIVATE_KEY,
    subject: values.VAPID_SUBJECT,
  };
}

/** See `AppConfig.storage`. Exported for its unit test. */
export function storageConfig(env: NodeJS.ProcessEnv): AppConfig['storage'] {
  const values = {
    R2_ENDPOINT: env['R2_ENDPOINT']?.trim() || '',
    R2_BUCKET: env['R2_BUCKET']?.trim() || '',
    R2_ACCESS_KEY_ID: env['R2_ACCESS_KEY_ID']?.trim() || '',
    R2_SECRET_ACCESS_KEY: env['R2_SECRET_ACCESS_KEY']?.trim() || '',
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length === 4) return undefined;
  if (missing.length) {
    throw new Error(`Media storage needs all four R2 variables; missing ${missing.join(', ')}.`);
  }
  const url = new URL(values.R2_ENDPOINT);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search) {
    throw new Error('R2_ENDPOINT must be an HTTPS origin such as https://<account>.r2.cloudflarestorage.com.');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(values.R2_BUCKET)) {
    throw new Error('R2_BUCKET must be a bucket name: lowercase letters, digits and hyphens.');
  }
  return {
    endpoint: url.origin,
    bucket: values.R2_BUCKET,
    accessKeyId: values.R2_ACCESS_KEY_ID,
    secretAccessKey: values.R2_SECRET_ACCESS_KEY,
  };
}

export function loadConfig(): AppConfig {
  const jwtSecret = required('JWT_SECRET', process.env['JWT_SECRET']);
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters. Generate one with `openssl rand -hex 32`.');
  }

  return {
    port: positiveInt('API_PORT', process.env['API_PORT'] ?? process.env['PORT'], 3333),
    mcpOAuthIssuer: oauthIssuer(),
    developerUserId: process.env['DEVELOPER_USER_ID']?.trim() || undefined,
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
    push: pushConfig(process.env),
    storage: storageConfig(process.env),
  };
}

export const CONFIG = 'APP_CONFIG';
