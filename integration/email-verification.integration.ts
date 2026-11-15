/**
 * #27 S5: email verification through the real API, Mongo and the development mail sink. It never
 * blocks anything; a link confirms the address it was sent to, once.
 */
import { randomUUID } from 'node:crypto';
import type { AuthSession, User } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

let n = 0;
const from = () => ({ 'X-Forwarded-For': `10.66.${Math.floor(n / 250)}.${n++ % 250}` });

async function person(): Promise<Account> {
  const email = `v-${randomUUID().slice(0, 8)}@int.test`;
  const registered = await api.call<AuthSession>(null, 'POST', '/auth/register', { email, password: `pw-${randomUUID()}`, name: 'Vera' }, from());
  expect(registered.status).toBe(201);
  return { id: registered.body.user.id, email, accessToken: registered.body.accessToken, refreshToken: registered.body.refreshToken };
}

async function tokens(email: string, atLeast = 1): Promise<string[]> {
  for (let i = 0; i < 50; i++) {
    const mail = await api.db.collection('dev_mail').find({ to: email, subject: 'Confirm your email for Life Portal' }).sort({ createdAt: -1 }).toArray();
    if (mail.length >= atLeast) return mail.map((m) => /verify-email#token=([A-Za-z0-9_-]+)/.exec(m['text'] as string)?.[1] as string);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no verification mail for ${email}`);
}

const confirm = (token: string) => api.call<{ code?: string; verified?: boolean }>(null, 'POST', '/auth/verify-email', { token }, from());
const me = (who: Account) => api.call<User>(who, 'GET', '/auth/me');

it('sends a link on sign-up without blocking the new account', async () => {
  const who = await person();
  const [token] = await tokens(who.email);
  expect(token).toBeTruthy();
  const before = await me(who);
  expect(before.status).toBe(200);
  expect(before.body.emailVerifiedAt).toBeUndefined();
});

it('confirms once, and says so afterwards', async () => {
  const who = await person();
  const [token] = await tokens(who.email);
  expect((await confirm(token as string)).body).toEqual({ verified: true });
  expect((await me(who)).body.emailVerifiedAt).toEqual(expect.any(String));
  expect((await confirm(token as string)).body.code).toBe('VERIFY_INVALID');
  expect((await api.call(who, 'POST', '/auth/verify-email/send')).body).toEqual({ sent: false, alreadyVerified: true });
});

it('voids the older link when a new one is sent', async () => {
  const who = await person();
  const [first] = await tokens(who.email);
  expect((await api.call(who, 'POST', '/auth/verify-email/send')).body).toEqual({ sent: true, alreadyVerified: false });
  const [second] = await tokens(who.email, 2);
  expect(second).not.toBe(first);
  expect((await confirm(first as string)).body.code).toBe('VERIFY_INVALID');
  expect((await confirm(second as string)).status).toBe(200);
});

it('does not confirm an address the account no longer has', async () => {
  const who = await person();
  const [token] = await tokens(who.email);
  await api.db.collection('users').updateOne({ email: who.email }, { $set: { email: `changed-${who.email}` } });
  expect((await confirm(token as string)).body.code).toBe('VERIFY_INVALID');
  const row = await api.db.collection('users').findOne({ email: `changed-${who.email}` });
  expect(row?.['emailVerifiedAt']).toBeUndefined();
});

it('limits sending to 5 an hour per account', async () => {
  const who = await person();
  for (let i = 0; i < 5; i++) expect((await api.call(who, 'POST', '/auth/verify-email/send')).status).toBe(200);
  expect((await api.call(who, 'POST', '/auth/verify-email/send')).status).toBe(429);
});

it('keeps accounts from before #27 working unverified', async () => {
  const who = await person();
  await api.db.collection('users').updateOne({ email: who.email }, { $unset: { emailVerifiedAt: 1 } });
  expect((await me(who)).status).toBe(200);
  expect((await api.call(who, 'GET', '/portal')).status).toBe(200);
});
