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
  /**
   * Reverse-proxy hops in front of the API (`TRUST_PROXY_HOPS`, default 1 for Render; 0 when
   * clients connect directly). Decides which X-Forwarded-For entry is `req.ip`.
   */
  trustProxyHops: number;
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
  /**
   * Where the web app is served (`WEB_BASE_URL`), for links in emails (issue #27). HTTPS, except
   * plain HTTP on a loopback host for development. Absent means emailed links are unavailable.
   */
  webBaseUrl?: string;
  /**
   * How email is sent (`MAIL_PROVIDER`). `resend` needs `RESEND_API_KEY` and `MAIL_FROM`; `dev`
   * stores messages in the `dev_mail` collection and is refused unless `WEB_BASE_URL` is a
   * loopback address, so it can never run in production. Absent means no email at all.
   */
  mail?: MailConfig;
  /**
   * Continue with Google (issue #28). Needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   * `API_PUBLIC_URL` (for the redirect URI) and `WEB_BASE_URL`; all or none. Absent hides the
   * button. `endpoints` is set only by `GOOGLE_OIDC_TEST_BASE`, a loopback fake for tests.
   */
  google?: GoogleConfig;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** `${API_PUBLIC_URL}/api/auth/google/callback`: what Google's console must list exactly. */
  redirectUri: string;
  endpoints?: { auth: string; token: string; certs: string };
}

export type MailConfig = { provider: 'resend'; apiKey: string; from: string } | { provider: 'dev'; from: string };

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

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/** See `AppConfig.webBaseUrl`. Exported for its unit test. */
export function webBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env['WEB_BASE_URL']?.trim();
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`WEB_BASE_URL must be a URL, got "${value}".`);
  }
  const loopback = LOOPBACK.includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('WEB_BASE_URL must be an HTTPS URL without credentials, query or fragment (HTTP loopback is allowed for development).');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** See `AppConfig.mail`. Exported for its unit test. */
export function mailConfig(env: NodeJS.ProcessEnv, web: string | undefined): MailConfig | undefined {
  const provider = env['MAIL_PROVIDER']?.trim().toLowerCase() || '';
  const apiKey = env['RESEND_API_KEY']?.trim() || '';
  const from = env['MAIL_FROM']?.trim() || '';
  if (!provider) {
    if (apiKey || from) throw new Error('RESEND_API_KEY or MAIL_FROM is set without MAIL_PROVIDER. Set MAIL_PROVIDER=resend.');
    return undefined;
  }
  if (provider === 'dev') {
    const host = web ? new URL(web).hostname : '';
    if (!LOOPBACK.includes(host)) {
      throw new Error('MAIL_PROVIDER=dev only works with a loopback WEB_BASE_URL. It keeps messages in the database and must never run in production.');
    }
    return { provider: 'dev', from: from || 'Life Portal <dev@localhost>' };
  }
  if (provider === 'resend') {
    const missing = [!apiKey && 'RESEND_API_KEY', !from && 'MAIL_FROM'].filter(Boolean);
    if (missing.length) throw new Error(`MAIL_PROVIDER=resend needs ${missing.join(' and ')}.`);
    if (!/@[^@\s>]+\.[^@\s>]+>?$/.test(from)) throw new Error('MAIL_FROM must be an address on your verified domain, e.g. "Life Portal <no-reply@example.com>".');
    return { provider: 'resend', apiKey, from };
  }
  throw new Error(`MAIL_PROVIDER must be "resend" or "dev", got "${provider}".`);
}

/** See `AppConfig.google`. Exported for its unit test. */
export function googleConfig(env: NodeJS.ProcessEnv, web: string | undefined): GoogleConfig | undefined {
  const clientId = env['GOOGLE_CLIENT_ID']?.trim() || '';
  const clientSecret = env['GOOGLE_CLIENT_SECRET']?.trim() || '';
  const apiUrl = env['API_PUBLIC_URL']?.trim() || '';
  if (!clientId && !clientSecret) return undefined;
  const missing = [!clientId && 'GOOGLE_CLIENT_ID', !clientSecret && 'GOOGLE_CLIENT_SECRET', !apiUrl && 'API_PUBLIC_URL', !web && 'WEB_BASE_URL'].filter(Boolean);
  if (missing.length) throw new Error(`Continue with Google needs ${missing.join(', ')}.`);
  if (!clientId.endsWith('.apps.googleusercontent.com') && !env['GOOGLE_OIDC_TEST_BASE']) {
    throw new Error('GOOGLE_CLIENT_ID should end in .apps.googleusercontent.com. Copy it from the Google Cloud console.');
  }
  let api: URL;
  try {
    api = new URL(apiUrl);
  } catch {
    throw new Error(`API_PUBLIC_URL must be a URL, got "${apiUrl}".`);
  }
  const loopback = LOOPBACK.includes(api.hostname);
  if (api.username || api.password || api.search || api.hash || api.pathname !== '/' || (api.protocol !== 'https:' && !(api.protocol === 'http:' && loopback))) {
    throw new Error('API_PUBLIC_URL must be the API\'s HTTPS origin, e.g. https://life-portal-api.onrender.com (HTTP loopback is allowed for development).');
  }
  const config: GoogleConfig = { clientId, clientSecret, redirectUri: `${api.origin}/api/auth/google/callback` };
  const testBase = env['GOOGLE_OIDC_TEST_BASE']?.trim();
  if (testBase) {
    const base = new URL(testBase);
    if (!LOOPBACK.includes(base.hostname) || !loopback) {
      throw new Error('GOOGLE_OIDC_TEST_BASE is for tests only and must be a loopback URL, with a loopback API_PUBLIC_URL.');
    }
    const root = base.href.replace(/\/+$/, '');
    config.endpoints = { auth: `${root}/auth`, token: `${root}/token`, certs: `${root}/certs` };
  }
  return config;
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

function proxyHops(value: string | undefined): number {
  if (value == null || value.trim() === '') return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5) {
    throw new Error(`TRUST_PROXY_HOPS must be a whole number from 0 to 5, got "${value}".`);
  }
  return parsed;
}

export function loadConfig(): AppConfig {
  const jwtSecret = required('JWT_SECRET', process.env['JWT_SECRET']);
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters. Generate one with `openssl rand -hex 32`.');
  }

  const web = webBaseUrl(process.env);
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
    trustProxyHops: proxyHops(process.env['TRUST_PROXY_HOPS']),
    finnhubApiKey: process.env['FINNHUB_API_KEY']?.trim() || undefined,
    offUserAgent: openFoodFactsUserAgent(),
    disableSchedules: process.env['DISABLE_SCHEDULES'] === 'true',
    push: pushConfig(process.env),
    storage: storageConfig(process.env),
    webBaseUrl: web,
    mail: mailConfig(process.env, web),
    google: googleConfig(process.env, web),
  };
}

export const CONFIG = 'APP_CONFIG';
