/**
 * #28: Continue with Google through the real API and Mongo, against a fake Google that signs
 * real RS256 ID tokens and checks PKCE. Covers state, nonce and PKCE; signature, issuer,
 * audience and expiry; unverified email; the linking attacks (email match, a callback opened in
 * another browser, a replayed code); sign-up with and without an invite; repeated sign-in;
 * unlinking without lockout; and redirect validation.
 */
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as jwt from 'jsonwebtoken';
import type { AuthSession, GoogleExchangeResult, SignInMethods } from '@life-portal/shared-types';
import { CONFIG, type AppConfig } from '../apps/api/src/config/configuration';
import { startApi, type Account, type TestApi } from './harness';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

/** Who the next person to pass the fake consent screen is, and how their token is made. */
interface Person {
  sub: string;
  email: string;
  verified?: boolean;
  name?: string;
}
interface Tamper {
  aud?: string;
  iss?: string;
  expired?: boolean;
  nonce?: string;
  wrongKey?: boolean;
}

const codes = new Map<string, { challenge: string; nonce: string; person: Person; tamper: Tamper; used?: boolean }>();
let fake: Server;
let fakeBase = '';

function startFakeGoogle(): Promise<void> {
  fake = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/certs') {
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'public, max-age=60');
      res.end(JSON.stringify({ k1: publicPem }));
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const grant = codes.get(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (!grant || grant.used || challenge !== grant.challenge || form.get('client_id') !== CLIENT_ID) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        grant.used = true;
        const now = Math.floor(Date.now() / 1000);
        const { person, tamper } = grant;
        const idToken = jwt.sign(
          {
            iss: tamper.iss ?? 'https://accounts.google.com',
            aud: tamper.aud ?? CLIENT_ID,
            sub: person.sub,
            email: person.email,
            email_verified: person.verified ?? true,
            name: person.name ?? 'Gia',
            nonce: tamper.nonce ?? grant.nonce,
            iat: tamper.expired ? now - 7200 : now,
            exp: tamper.expired ? now - 3600 : now + 3600,
          },
          (tamper.wrongKey ? otherKeys : keys).privateKey.export({ type: 'pkcs8', format: 'pem' }),
          { algorithm: 'RS256', keyid: 'k1' },
        );
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ access_token: 'unused', token_type: 'Bearer', expires_in: 3600, id_token: idToken }));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => fake.listen(0, '127.0.0.1', () => {
    fakeBase = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    resolve();
  }));
}

let api: TestApi;
const googleEnv = () => ({
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'test-secret',
  API_PUBLIC_URL: 'http://127.0.0.1:1',
  GOOGLE_OIDC_TEST_BASE: fakeBase,
});
beforeAll(async () => {
  await startFakeGoogle();
  api = await startApi(googleEnv());
});
afterAll(async () => {
  await api?.close();
  await new Promise((resolve) => fake.close(resolve));
});

let n = 0;
const ip = () => ({ 'X-Forwarded-For': `10.55.${Math.floor(n / 250)}.${n++ % 250}` });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

async function location(path: string): Promise<URL> {
  const response = await fetch(api.url + path, { redirect: 'manual', headers: ip() });
  expect(response.status).toBe(302);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return new URL(response.headers.get('location') as string);
}

/**
 * One browser's round trip: start, the fake consent screen, the callback. Returns the fragment
 * the API sends the web app, and the binding secret this browser kept.
 */
async function roundTrip(
  person: Person,
  options: { intent?: 'link'; ticket?: string; returnTo?: string; tamper?: Tamper; error?: string } = {},
) {
  const binding = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({ binding: sha(binding), returnTo: options.returnTo ?? '/training' });
  if (options.intent) query.set('intent', options.intent);
  if (options.ticket) query.set('ticket', options.ticket);
  const toGoogle = await location(`/auth/google/start?${query}`);
  const fragment = (url: URL) => new URLSearchParams(url.hash.slice(1));
  if (!toGoogle.href.startsWith(fakeBase)) return { binding, fragment: fragment(toGoogle), toGoogle };

  expect(toGoogle.searchParams.get('code_challenge_method')).toBe('S256');
  expect(toGoogle.searchParams.get('client_id')).toBe(CLIENT_ID);
  expect(toGoogle.searchParams.get('scope')).toBe('openid email profile');
  const state = toGoogle.searchParams.get('state') as string;
  const callback = new URLSearchParams({ state });
  if (options.error) {
    callback.set('error', options.error);
  } else {
    const code = randomUUID();
    codes.set(code, {
      challenge: toGoogle.searchParams.get('code_challenge') as string,
      nonce: toGoogle.searchParams.get('nonce') as string,
      person,
      tamper: options.tamper ?? {},
    });
    callback.set('code', code);
  }
  const back = await location(`/auth/google/callback?${callback}`);
  expect(back.origin + back.pathname).toBe('http://localhost:4200/auth/google');
  return { binding, fragment: fragment(back), state, toGoogle };
}

const exchange = (code: string, binding: string) =>
  api.call<GoogleExchangeResult & { code?: string }>(null, 'POST', '/auth/google/exchange', { code, binding }, ip());

async function signInWithGoogle(person: Person, options: Parameters<typeof roundTrip>[1] = {}) {
  const trip = await roundTrip(person, options);
  const code = trip.fragment.get('code');
  if (!code) return { trip, result: { kind: 'error', code: trip.fragment.get('error') } as GoogleExchangeResult };
  const answer = await exchange(code, trip.binding);
  return { trip, result: answer.body, status: answer.status };
}

const asAccount = (session: AuthSession): Account => ({ id: session.user.id, email: session.user.email, accessToken: session.accessToken, refreshToken: session.refreshToken });
const googler = (): Person => ({ sub: `g-${randomUUID()}`, email: `g-${randomUUID().slice(0, 8)}@gmail.test` });

async function passwordAccount() {
  const email = `p-${randomUUID().slice(0, 8)}@int.test`;
  const password = `pw-${randomUUID()}`;
  const registered = await api.call<AuthSession>(null, 'POST', '/auth/register', { email, password, name: 'Pat' }, ip());
  return { email, password, session: registered.body };
}

it('says Google is available', async () => {
  expect((await api.call(null, 'GET', '/auth/capabilities')).body).toMatchObject({ google: true });
});

describe('signing up and in', () => {
  it('creates a Google-only account with a verified email, then signs the same person into it again', async () => {
    const person = googler();
    const first = await signInWithGoogle(person);
    expect(first.result.kind).toBe("session");
    if (first.result.kind !== 'session') return;
    expect(first.result.returnTo).toBe('/training');
    const me = asAccount(first.result.session);
    const profile = await api.call<{ emailVerifiedAt?: string }>(me, 'GET', '/auth/me');
    expect(profile.body.emailVerifiedAt).toEqual(expect.any(String));
    expect((await api.call<SignInMethods>(me, 'GET', '/auth/methods')).body).toMatchObject({ password: false, google: { email: person.email } });

    const again = await signInWithGoogle({ ...person, email: `renamed-${person.email}` });
    expect(again.result.kind).toBe('session');
    if (again.result.kind === 'session') expect(again.result.session.user.id).toBe(me.id);
    // Two Google sign-ins are two ordinary sessions (#27): one ends without the other.
    expect((await api.call(me, 'POST', '/auth/logout')).status).toBe(200);
    if (again.result.kind === 'session') expect((await api.call(asAccount(again.result.session), 'GET', '/auth/me')).status).toBe(200);
  });

  it('cannot sign a Google-only account in with a password, and explains change-password', async () => {
    const person = googler();
    const { result } = await signInWithGoogle(person);
    if (result.kind !== 'session') throw new Error('expected a session');
    expect((await api.call(null, 'POST', '/auth/login', { email: person.email, password: 'anything-at-all' }, ip())).status).toBe(401);
    const change = await api.call<{ code: string }>(asAccount(result.session), 'POST', '/auth/change-password', { currentPassword: 'x', newPassword: 'a-new-password-1' });
    expect(change.body.code).toBe('NO_PASSWORD');
  });

  it('needs the invite code for a new account when sign-up is invite-only', async () => {
    // Invite-only for this test: the API reads the code from its config on every sign-up.
    const config = api.app.get<AppConfig>(CONFIG);
    config.registrationInviteCode = 'let-me-in';
    try {
      const person = googler();
      const { trip, result } = await signInWithGoogle(person);
      expect(result.kind).toBe('needs_invite');
      if (result.kind !== 'needs_invite') return;
      expect(await api.db.collection('users').countDocuments({ email: person.email })).toBe(0);

      const signup = (inviteCode: string, binding = trip.binding) =>
        api.call<GoogleExchangeResult>(null, 'POST', '/auth/google/complete-signup', { ticket: result.ticket, binding, inviteCode }, ip());
      expect((await signup('nope')).status).toBe(403);
      expect((await signup('let-me-in', randomBytes(32).toString('base64url'))).status).toBe(400);
      expect((await signup('let-me-in')).body.kind).toBe('session');
      expect((await signup('let-me-in')).status).toBe(400);
      expect(await api.db.collection('users').countDocuments({ email: person.email })).toBe(1);
    } finally {
      delete config.registrationInviteCode;
    }
  });
});

describe('linking', () => {
  it('never links to an existing account on a matching email alone; its password does', async () => {
    const owner = await passwordAccount();
    const attacker: Person = { sub: `g-${randomUUID()}`, email: owner.email };
    const { trip, result } = await signInWithGoogle(attacker);
    expect(result.kind).toBe('needs_password');
    if (result.kind !== 'needs_password') return;
    expect(await api.db.collection('user_identities').countDocuments({ subject: attacker.sub })).toBe(0);

    const wrong = await api.call(null, 'POST', '/auth/google/link-with-password', { ticket: result.ticket, binding: trip.binding, password: 'not-the-password' }, ip());
    expect(wrong.status).toBe(401);
    expect(await api.db.collection('user_identities').countDocuments({ subject: attacker.sub })).toBe(0);

    const right = await api.call<GoogleExchangeResult>(null, 'POST', '/auth/google/link-with-password', { ticket: result.ticket, binding: trip.binding, password: owner.password }, ip());
    expect(right.body.kind).toBe('session');
    if (right.body.kind === 'session') expect(right.body.session.user.id).toBe(owner.session.user.id);

    const later = await signInWithGoogle(attacker);
    expect(later.result.kind).toBe('session');
  });

  it('links from Settings with a ticket, and refuses a Google account linked elsewhere', async () => {
    const owner = await passwordAccount();
    const me = asAccount(owner.session);
    const ticket = (await api.call<{ ticket: string }>(me, 'POST', '/auth/google/link-ticket')).body.ticket;
    const person = googler();
    const { result } = await signInWithGoogle(person, { intent: 'link', ticket, returnTo: '/settings/security' });
    expect(result).toEqual({ kind: 'linked', returnTo: '/settings/security' });
    expect((await api.call<SignInMethods>(me, 'GET', '/auth/methods')).body.google?.email).toBe(person.email);

    const other = asAccount((await passwordAccount()).session);
    const otherTicket = (await api.call<{ ticket: string }>(other, 'POST', '/auth/google/link-ticket')).body.ticket;
    const clash = await signInWithGoogle(person, { intent: 'link', ticket: otherTicket });
    expect(clash.result).toEqual({ kind: 'error', code: 'already_linked_elsewhere' });
  });

  it('refuses a link ticket that was used or made up', async () => {
    const me = asAccount((await passwordAccount()).session);
    const ticket = (await api.call<{ ticket: string }>(me, 'POST', '/auth/google/link-ticket')).body.ticket;
    await signInWithGoogle(googler(), { intent: 'link', ticket });
    const reused = await roundTrip(googler(), { intent: 'link', ticket });
    expect(reused.fragment.get('error')).toBe('expired');
    const madeUp = await roundTrip(googler(), { intent: 'link', ticket: 'x'.repeat(43) });
    expect(madeUp.fragment.get('error')).toBe('expired');
  });

  it('unlinks only when a password is left to sign in with', async () => {
    const owner = await passwordAccount();
    const me = asAccount(owner.session);
    const ticket = (await api.call<{ ticket: string }>(me, 'POST', '/auth/google/link-ticket')).body.ticket;
    await signInWithGoogle(googler(), { intent: 'link', ticket });
    expect((await api.call<SignInMethods>(me, 'DELETE', '/auth/google')).body.google).toBeNull();

    const googleOnly = await signInWithGoogle(googler());
    if (googleOnly.result.kind !== 'session') throw new Error('expected a session');
    const refused = await api.call<{ code: string }>(asAccount(googleOnly.result.session), 'DELETE', '/auth/google');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('LAST_SIGN_IN_METHOD');
  });
});

describe('the round trip is bound to one browser and works once', () => {
  it('refuses the code in another browser (login CSRF) and a second time', async () => {
    const { trip } = await (async () => ({ trip: await roundTrip(googler()) }))();
    const code = trip.fragment.get('code') as string;
    const otherBrowser = randomBytes(32).toString('base64url');
    expect((await exchange(code, otherBrowser)).status).toBe(400);
    expect((await exchange(code, trip.binding)).body.kind).toBe('session');
    expect((await exchange(code, trip.binding)).status).toBe(400);
  });

  it('refuses a replayed state and an unknown state', async () => {
    const trip = await roundTrip(googler());
    const replay = await location(`/auth/google/callback?${new URLSearchParams({ state: trip.state as string, code: 'x' })}`);
    expect(new URLSearchParams(replay.hash.slice(1)).get('error')).toBe('expired');
    const unknown = await location('/auth/google/callback?state=nope&code=x');
    expect(new URLSearchParams(unknown.hash.slice(1)).get('error')).toBe('expired');
  });

  it('refuses a start without a well-formed binding', async () => {
    const back = await location('/auth/google/start?binding=short');
    expect(new URLSearchParams(back.hash.slice(1)).get('error')).toBe('failed');
  });

  it('keeps the person on the web app whatever returnTo says', async () => {
    for (const evil of ['https://evil.example/x', '//evil.example', '/\\evil.example']) {
      const { result } = await signInWithGoogle(googler(), { returnTo: evil });
      expect(result.kind === 'session' && result.returnTo).toBe('/');
    }
  });

  it('reports a cancelled consent screen', async () => {
    const { result } = await signInWithGoogle(googler(), { error: 'access_denied' });
    expect(result).toEqual({ kind: 'error', code: 'cancelled' });
  });
});

describe('the ID token is checked', () => {
  const cases: [string, Tamper][] = [
    ['another audience', { aud: 'someone-else.apps.googleusercontent.com' }],
    ['another issuer', { iss: 'https://evil.example' }],
    ['an expired token', { expired: true }],
    ['another nonce', { nonce: 'replayed' }],
    ['a signature from another key', { wrongKey: true }],
  ];
  it.each(cases)('refuses %s', async (_label, tamper) => {
    const person = googler();
    const { result } = await signInWithGoogle(person, { tamper });
    expect(result).toEqual({ kind: 'error', code: 'failed' });
    expect(await api.db.collection('users').countDocuments({ email: person.email })).toBe(0);
  });

  it('refuses an email Google has not verified', async () => {
    const person = { ...googler(), verified: false };
    const { result } = await signInWithGoogle(person);
    expect(result).toEqual({ kind: 'error', code: 'email_unverified' });
  });

  it('records sign-ins and failures without tokens or emails', async () => {
    const person = googler();
    await signInWithGoogle(person);
    const events = JSON.stringify(await api.db.collection('security_events').find({ type: /^google_/ }).toArray());
    expect(events).toContain('google_signin');
    expect(events).toContain('google_failed');
    expect(events).not.toContain(person.email);
    expect(events).not.toContain('eyJ');
  });
});
