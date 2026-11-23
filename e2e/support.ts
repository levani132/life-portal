import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { test as base, expect, type Page } from '@playwright/test';

export const API = 'http://localhost:3333/api';

export interface Account {
  id: string;
  email: string;
  password: string;
  name: string;
  accessToken: string;
  refreshToken: string;
}

let mongo: MongoClient | undefined;
/** The test database, for what has no route: every feature on, setup done. Only `lp-e2e`. */
export async function db() {
  if (!mongo) {
    mongo = new MongoClient((process.env['E2E_MONGODB_URI'] ?? '').replace(/\/+$/, ''));
    await mongo.connect();
  }
  return mongo.db('lp-e2e');
}

/** Calls the API as an account (or nobody). JSON in, JSON out. */
export async function call<T = Record<string, unknown>>(who: Pick<Account, 'accessToken'> | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(API + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(who ? { authorization: `Bearer ${who.accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * A new account with every feature on and setup done, signed in through the API. Each comes from
 * its own address, since sign-in is rate-limited per address.
 */
export async function account(name = 'Tester'): Promise<Account> {
  const email = `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID().slice(0, 8)}@e2e.test`;
  const password = `pw-${randomUUID()}`;
  const from = { 'X-Forwarded-For': `10.${randomBytes(3).join('.')}` };
  await call(null, 'POST', '/auth/register', { email, password, name }, from);
  const users = (await db()).collection('users');
  await users.updateOne({ email }, { $set: { cohort: 'internal', emailVerifiedAt: new Date() } });
  const login = await call<{ accessToken: string; refreshToken: string }>(null, 'POST', '/auth/login', { email, password }, from);
  const id = JSON.parse(Buffer.from(login.accessToken.split('.')[1], 'base64url').toString()).sub as string;
  await (await db()).collection('user_settings').updateOne({ userId: id }, { $set: { userId: id, completedSetupSteps: [], setupDismissed: true } }, { upsert: true });
  return { id, email, password, name, ...login };
}

/** Opens the app already signed in as the account (tokens where the web app keeps them). */
export async function signIn(page: Page, who: Account): Promise<void> {
  await page.addInitScript(
    ([access, refresh]) => {
      window.localStorage.setItem('lp.accessToken', access);
      window.localStorage.setItem('lp.refreshToken', refresh);
    },
    [who.accessToken, who.refreshToken],
  );
}

/** The day as the app sees it (4 a.m. day start), for API calls that need one. */
export function today(): string {
  const now = new Date(Date.now() - 4 * 3600_000);
  return now.toISOString().slice(0, 10);
}

/** A phone screenshot of the page as it is, saved for review under e2e/screenshots. */
export async function snap(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `screenshots/${name}.png` });
}

export const test = base;
export { expect };
