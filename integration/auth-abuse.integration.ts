/**
 * #27 S2: abuse protection through the real API and Mongo. Sign-in is limited per account and per
 * IP with a generic 429; an unknown email is answered like a wrong password, in about the same
 * time; the password policy applies wherever a password is set; and the security log holds no
 * email, password, token or raw IP.
 */
import { randomUUID } from 'node:crypto';
import type { AuthSession } from '@life-portal/shared-types';
import { startApi, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

let n = 0;
const ip = () => `10.77.${Math.floor(n / 250)}.${n++ % 250}`;
const from = (address = ip()) => ({ 'X-Forwarded-For': address });

async function person(password = `pw-${randomUUID()}`) {
  const email = `a-${randomUUID().slice(0, 8)}@int.test`;
  const registered = await api.call<AuthSession>(null, 'POST', '/auth/register', { email, password, name: 'A' }, from());
  expect(registered.status).toBe(201);
  return { email, password, id: registered.body.user.id, creds: { email, password } };
}

describe('sign-in limits', () => {
  it('locks one account after 10 attempts in the window, even with the right password, and only that account', async () => {
    const target = await person();
    const other = await person();
    for (let i = 0; i < 10; i++) {
      const wrong = await api.call(null, 'POST', '/auth/login', { email: target.email, password: 'wrong-password' }, from());
      expect(wrong.status).toBe(401);
    }
    const locked = await api.call<{ code: string; message: string }>(null, 'POST', '/auth/login', target.creds, from());
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('RATE_LIMITED');
    // Same answer for an email that is not registered, so a lock reveals nothing either.
    expect(locked.body.message).toBe('Too many attempts. Try again in a little while.');

    expect((await api.call(null, 'POST', '/auth/login', other.creds, from())).status).toBe(200);
  });

  it('limits one IP across accounts', async () => {
    const address = ip();
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await api.call(null, 'POST', '/auth/login', { email: `nobody-${i}@int.test`, password: 'whatever-123' }, from(address))).status;
    }
    expect(last).toBe(429);
    const someone = await person();
    expect((await api.call(null, 'POST', '/auth/login', someone.creds, from())).status).toBe(200);
  });
});

describe('no account enumeration on sign-in', () => {
  it('answers an unknown email like a wrong password, in comparable time', async () => {
    const known = await person();
    const time = async (email: string) => {
      const started = Date.now();
      const answer = await api.call<{ message: string }>(null, 'POST', '/auth/login', { email, password: 'wrong-password' }, from());
      return { ms: Date.now() - started, answer };
    };
    await time('warm-up@int.test');
    const unknown = await time(`ghost-${randomUUID().slice(0, 8)}@int.test`);
    const wrong = await time(known.email);
    expect(unknown.answer.status).toBe(401);
    expect(unknown.answer.body.message).toBe(wrong.answer.body.message);
    // Both run a cost-12 bcrypt compare. Before #27 an unknown email took ~1 ms against ~280.
    expect(unknown.ms).toBeGreaterThan(wrong.ms / 3);
  });
});

describe('password policy', () => {
  it('applies on registration', async () => {
    const register = (password: string) =>
      api.call<{ code: string; reason: string }>(null, 'POST', '/auth/register', { email: `p-${randomUUID().slice(0, 8)}@int.test`, password, name: 'P' }, from());
    expect((await register('Password123')).body).toMatchObject({ code: 'WEAK_PASSWORD', reason: 'common' });
    expect((await register('ა'.repeat(25))).body).toMatchObject({ code: 'WEAK_PASSWORD' });
    expect((await register('x'.repeat(73))).body).toMatchObject({ code: 'WEAK_PASSWORD' });
  });

  it('applies on change, and refuses the current password as the new one', async () => {
    const who = await person();
    const session = (await api.call<AuthSession>(null, 'POST', '/auth/login', who.creds, from())).body;
    const me = { id: who.id, email: who.email, accessToken: session.accessToken, refreshToken: session.refreshToken };
    const change = (newPassword: string) => api.call<{ code: string }>(me, 'POST', '/auth/change-password', { currentPassword: who.password, newPassword });
    expect((await change('qwertyuiop')).body.code).toBe('WEAK_PASSWORD');
    expect((await change(who.password)).body.code).toBe('SAME_PASSWORD');
    expect((await change(`fresh-${randomUUID()}`)).status).toBe(200);
  });
});

describe('the security log', () => {
  it('records sign-ins without emails, passwords, tokens or raw IPs', async () => {
    const who = await person();
    await api.call(null, 'POST', '/auth/login', { email: who.email, password: 'wrong-password' }, from('10.99.1.2'));
    await api.call(null, 'POST', '/auth/login', who.creds, from('10.99.1.2'));

    const events = await api.db.collection('security_events').find({ userId: who.id }).toArray();
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['register', 'login_failed', 'login_succeeded']));
    const text = JSON.stringify(await api.db.collection('security_events').find().toArray());
    expect(text).not.toContain(who.email);
    expect(text).not.toContain(who.password);
    expect(text).not.toContain('10.99.1.2');
    expect(text).not.toContain('eyJ');
    const counters = JSON.stringify(await api.db.collection('auth_rate_limits').find().toArray());
    expect(counters).not.toContain(who.email);
    expect(counters).not.toContain('10.99.1.2');
  });
});
