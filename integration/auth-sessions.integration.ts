/**
 * #27 S1: sign-in sessions through the real API and Mongo. A refresh token works once; a reused
 * one ends its session; two refreshes racing with one token never sign anyone out; logout,
 * "sign out everywhere" and a password change take effect immediately; tokens from before
 * sessions existed are refused; one account never sees or ends another's sessions.
 */
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import type { AuthSession, AuthSessionInfo, AuthTokens } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

interface Person {
  email: string;
  password: string;
}

// A fresh address per person, so the per-IP sign-in limits (S2) never get in the way here.
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function person(): Promise<Person> {
  const email = `s-${randomUUID().slice(0, 8)}@int.test`;
  const password = `pw-${randomUUID()}`;
  const registered = await api.call(null, 'POST', '/auth/register', { email, password, name: 'S' }, { 'X-Forwarded-For': ip() });
  expect(registered.status).toBe(201);
  return { email, password };
}

async function signIn(who: Person, userAgent = 'Mozilla/5.0 (Macintosh) Chrome/130.0 Safari/537.36'): Promise<Account> {
  const answer = await api.call<AuthSession>(null, 'POST', '/auth/login', who, { 'User-Agent': userAgent, 'X-Forwarded-For': ip() });
  expect(answer.status).toBe(200);
  // Body mode (no `x-lp-session` header), so the refresh token is always in the answer (#29).
  return { id: answer.body.user.id, email: who.email, ...answer.body, refreshToken: answer.body.refreshToken as string };
}

const refresh = (token: string) => api.call<AuthTokens & { code?: string }>(null, 'POST', '/auth/refresh', { refreshToken: token });
const me = (who: Account) => api.call(who, 'GET', '/auth/me');
const sessionsOf = (who: Account) => api.call<AuthSessionInfo[]>(who, 'GET', '/auth/sessions');

describe('refresh rotation', () => {
  it('issues a new pair and refuses the old token afterwards, ending the session', async () => {
    const who = await signIn(await person());
    const first = await refresh(who.refreshToken);
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(who.refreshToken);
    const next = { ...who, ...first.body };
    expect((await me(next)).status).toBe(200);

    // Past the grace window, the old token is a replay. Move the rotation back instead of waiting.
    await api.db.collection('auth_sessions').updateMany({}, { $set: { rotatedAt: new Date(Date.now() - 60_000) } });
    const replay = await refresh(who.refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('REFRESH_REUSED');

    // The replay ended the session for whoever holds the current token too.
    expect((await me(next)).status).toBe(401);
    expect((await refresh(next.refreshToken)).body.code).toBe('SESSION_ENDED');
  });

  it('lets exactly one of two simultaneous refreshes win, and signs nobody out', async () => {
    const who = await signIn(await person());
    const [a, b] = await Promise.all([refresh(who.refreshToken), refresh(who.refreshToken)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('REFRESH_SUPERSEDED');
    const winner = a.status === 200 ? a : b;
    expect((await me({ ...who, ...winner.body })).status).toBe(200);
    expect((await refresh(winner.body.refreshToken)).status).toBe(200);
  });

  it('gives every refresh token its own hash, however alike the payloads', async () => {
    const who = await signIn(await person());
    const tokens = new Set<string>([who.refreshToken]);
    let current = who.refreshToken;
    for (let i = 0; i < 3; i++) {
      const next = await refresh(current);
      expect(next.status).toBe(200);
      tokens.add(next.body.refreshToken);
      current = next.body.refreshToken;
    }
    expect(tokens.size).toBe(4);
  });
});

describe('tokens from before sessions', () => {
  it('refuses a refresh token and an access token without a session', async () => {
    const who = await signIn(await person());
    const secret = process.env['JWT_SECRET'] as string;
    const base = { sub: who.id, email: who.email, roles: ['owner'] };
    const legacyRefresh = jwt.sign({ ...base, typ: 'refresh' }, secret, { expiresIn: 3600 });
    const legacyAccess = jwt.sign({ ...base, typ: 'access' }, secret, { expiresIn: 900 });

    const refused = await refresh(legacyRefresh);
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('LEGACY_SESSION');
    expect((await me({ ...who, accessToken: legacyAccess })).status).toBe(401);
  });
});

describe('signing out', () => {
  it('logout ends this device only; logout-all ends every device at once', async () => {
    const p = await person();
    const phone = await signIn(p, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1');
    const laptop = await signIn(p);
    const tablet = await signIn(p);

    expect((await api.call(phone, 'POST', '/auth/logout')).status).toBe(200);
    expect((await me(phone)).status).toBe(401);
    expect((await refresh(phone.refreshToken)).body.code).toBe('SESSION_ENDED');
    expect((await me(laptop)).status).toBe(200);

    expect((await api.call(laptop, 'POST', '/auth/logout-all')).status).toBe(200);
    expect((await me(laptop)).status).toBe(401);
    expect((await me(tablet)).status).toBe(401);
  });

  it('lists devices, ends one, and ends the others while keeping this one', async () => {
    const p = await person();
    const phone = await signIn(p, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1');
    const laptop = await signIn(p);
    const tablet = await signIn(p);

    const listed = await sessionsOf(laptop);
    // Registration signs in too, so there is one more session than the three here.
    expect(listed.body).toHaveLength(4);
    expect(listed.body.filter((s) => s.current)).toHaveLength(1);
    expect(listed.body.map((s) => s.device)).toContain('Safari on iPhone');

    const phoneRow = (await sessionsOf(phone)).body.find((s) => s.current) as AuthSessionInfo;
    expect((await api.call(laptop, 'DELETE', `/auth/sessions/${phoneRow.id}`)).status).toBe(200);
    expect((await me(phone)).status).toBe(401);

    const others = await api.call<{ ended: number }>(laptop, 'POST', '/auth/sessions/revoke-others');
    expect(others.body.ended).toBe(2);
    expect((await me(tablet)).status).toBe(401);
    expect((await me(laptop)).status).toBe(200);
  });

  it('never shows or ends another account’s sessions', async () => {
    const mine = await signIn(await person());
    const theirs = await signIn(await person());
    const theirRow = (await sessionsOf(theirs)).body.find((s) => s.current) as AuthSessionInfo;

    expect((await sessionsOf(mine)).body.map((s) => s.id)).not.toContain(theirRow.id);
    expect((await api.call(mine, 'DELETE', `/auth/sessions/${theirRow.id}`)).status).toBe(404);
    expect((await me(theirs)).status).toBe(200);
  });
});

describe('changing the password', () => {
  it('keeps this session, ends every other one at once, and signs in with the new password', async () => {
    const p = await person();
    const here = await signIn(p);
    const there = await signIn(p);
    const newPassword = `new-${randomUUID()}`;

    const wrong = await api.call(here, 'POST', '/auth/change-password', { currentPassword: 'nope', newPassword });
    expect(wrong.status).toBe(401);
    expect((await me(there)).status).toBe(200);

    const changed = await api.call(here, 'POST', '/auth/change-password', { currentPassword: p.password, newPassword });
    expect(changed.status).toBe(200);
    expect((await me(here)).status).toBe(200);
    expect((await me(there)).status).toBe(401);
    expect((await refresh(there.refreshToken)).status).toBe(401);

    expect((await api.call(null, 'POST', '/auth/login', p)).status).toBe(401);
    expect((await api.call(null, 'POST', '/auth/login', { email: p.email, password: newPassword })).status).toBe(200);
  });
});
