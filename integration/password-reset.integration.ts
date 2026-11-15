/**
 * #27 S3: forgot / reset password through the real API, Mongo and the development mail sink.
 * The request answers the same for any email; a link works once, for 30 minutes, and a newer one
 * voids it; a reset signs every device out; a weak password does not burn the link; two resets
 * racing with one link change the password once.
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
const from = () => ({ 'X-Forwarded-For': `10.88.${Math.floor(n / 250)}.${n++ % 250}` });

async function person() {
  const email = `r-${randomUUID().slice(0, 8)}@int.test`;
  const password = `pw-${randomUUID()}`;
  const registered = await api.call<AuthSession>(null, 'POST', '/auth/register', { email, password, name: 'Rita <b>' }, from());
  expect(registered.status).toBe(201);
  return { email, password, id: registered.body.user.id, session: registered.body };
}

const forgot = (email: string) => api.call<{ message: string; code?: string }>(null, 'POST', '/auth/forgot-password', { email }, from());
const reset = (token: string, password: string) =>
  api.call<{ code?: string; success?: boolean }>(null, 'POST', '/auth/reset-password', { token, password }, from());
const login = (email: string, password: string) => api.call(null, 'POST', '/auth/login', { email, password }, from());

/** The newest link in the sink for this address, waiting for the send that runs after the answer. */
async function linkFor(email: string, after = 0): Promise<{ token: string; text: string; html: string; count: number }> {
  for (let i = 0; i < 50; i++) {
    // Sign-up also sends a verification email (S5); only the reset ones count here.
    const mail = await api.db.collection('dev_mail').find({ to: email, subject: 'Reset your Life Portal password' }).sort({ createdAt: -1 }).toArray();
    if (mail.length > after) {
      const text = mail[0]['text'] as string;
      const token = /reset-password#token=([A-Za-z0-9_-]+)/.exec(text)?.[1] as string;
      return { token, text, html: mail[0]['html'] as string, count: mail.length };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no mail for ${email}`);
}

it('reports that reset works on this server', async () => {
  expect((await api.call(null, 'GET', '/auth/capabilities')).body).toEqual({ passwordReset: true, emailVerification: true });
});

describe('asking for a link', () => {
  it('answers an unknown email exactly like a known one, and mails only the known one', async () => {
    const who = await person();
    const unknown = `ghost-${randomUUID().slice(0, 8)}@int.test`;
    const a = await forgot(who.email);
    const b = await forgot(unknown);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);

    const mail = await linkFor(who.email);
    expect(mail.text).toContain('http://localhost:4200/reset-password#token=');
    expect(mail.html).toContain('Rita &lt;b&gt;');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await api.db.collection('dev_mail').countDocuments({ to: unknown })).toBe(0);
    // A reset proves the inbox, so it confirms the email too (S5).
  });

  it('stores only a hash of the token, and logs no token', async () => {
    const who = await person();
    await forgot(who.email);
    const { token } = await linkFor(who.email);
    const stored = JSON.stringify(await api.db.collection('auth_email_tokens').find({ userId: who.id }).toArray());
    expect(stored).not.toContain(token);
    expect(JSON.stringify(await api.db.collection('security_events').find().toArray())).not.toContain(token);
  });

  it('limits requests per address to 3 an hour', async () => {
    const who = await person();
    for (let i = 0; i < 3; i++) expect((await forgot(who.email)).status).toBe(202);
    expect((await forgot(who.email)).status).toBe(429);
  });
});

describe('using a link', () => {
  it('sets the password, signs every device out, and works only once', async () => {
    const who = await person();
    const other = (await api.call<AuthSession>(null, 'POST', '/auth/login', { email: who.email, password: who.password }, from())).body;
    await forgot(who.email);
    const { token } = await linkFor(who.email);

    expect((await api.call(null, 'POST', '/auth/reset-password/check', { token }, from())).body).toEqual({ valid: true });
    const newPassword = `new-${randomUUID()}`;
    expect((await reset(token, newPassword)).status).toBe(200);

    expect((await api.call({ ...other, id: who.id, email: who.email }, 'GET', '/auth/me')).status).toBe(401);
    expect((await api.call({ ...who.session, id: who.id, email: who.email }, 'GET', '/auth/me')).status).toBe(401);
    expect((await login(who.email, who.password)).status).toBe(401);
    expect((await login(who.email, newPassword)).status).toBe(200);
    const after = await api.db.collection('users').findOne({ email: who.email });
    expect(after?.['emailVerifiedAt']).toBeInstanceOf(Date);

    const again = await reset(token, `other-${randomUUID()}`);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('RESET_INVALID');
    expect((await api.call(null, 'POST', '/auth/reset-password/check', { token }, from())).body).toEqual({ valid: false });
  });

  it('refuses an expired link, and a link replaced by a newer one', async () => {
    const who = await person();
    await forgot(who.email);
    const first = await linkFor(who.email);
    await forgot(who.email);
    const second = await linkFor(who.email, first.count);
    expect((await reset(first.token, `x-${randomUUID()}`)).body.code).toBe('RESET_INVALID');

    await api.db.collection('auth_email_tokens').updateMany({ userId: who.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await reset(second.token, `x-${randomUUID()}`)).body.code).toBe('RESET_INVALID');
  });

  it('does not burn the link on a weak password', async () => {
    const who = await person();
    await forgot(who.email);
    const { token } = await linkFor(who.email);
    expect((await reset(token, 'password123')).body.code).toBe('WEAK_PASSWORD');
    expect((await reset(token, `good-${randomUUID()}`)).status).toBe(200);
  });

  it('changes the password once when two resets race with one link', async () => {
    const who = await person();
    await forgot(who.email);
    const { token } = await linkFor(who.email);
    const [a, b] = await Promise.all([reset(token, `a-${randomUUID()}`), reset(token, `b-${randomUUID()}`)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it('refuses a made-up token the same way', async () => {
    expect((await reset('not-a-real-token', `x-${randomUUID()}`)).body.code).toBe('RESET_INVALID');
  });
});
