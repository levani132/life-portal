/**
 * Boots the real API in this process against a throwaway database (issue #22).
 *
 * Every test file gets its own database, `lp-int-<random>`, dropped by `close()`. Environment
 * variables are set *before* the app module is loaded, because some modules read the config at
 * import time. Nothing here needs a secret: the JWT secret is random per run.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';

export interface Account {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export interface Answer<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export interface TestApi {
  url: string;
  app: INestApplication;
  db: Connection;
  call<T = Record<string, unknown>>(
    who: Account | null,
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Answer<T>>;
  /** Registers an account with every feature on (the `internal` cohort) and signs it in. */
  account(name?: string): Promise<Account>;
  close(): Promise<void>;
}

export function mongoBase(): string {
  const uri = process.env['INTEGRATION_MONGODB_URI']?.trim();
  if (!uri) {
    throw new Error(
      'INTEGRATION_MONGODB_URI is not set. Start a throwaway Mongo, e.g.\n' +
        '  docker run -d --name lp-int-mongo -p 27020:27017 mongo:7\n' +
        'and run: INTEGRATION_MONGODB_URI=mongodb://127.0.0.1:27020 npm run test:integration\n' +
        'Never point it at a database you care about: each test file creates and drops its own.',
    );
  }
  return uri.replace(/\/+$/, '');
}

export async function startApi(): Promise<TestApi> {
  const dbName = `lp-int-${randomBytes(6).toString('hex')}`;
  process.env['MONGODB_URI'] = `${mongoBase()}/${dbName}`;
  process.env['JWT_SECRET'] = randomBytes(32).toString('hex');
  process.env['DISABLE_SCHEDULES'] = 'true';
  delete process.env['REGISTRATION_INVITE_CODE'];
  delete process.env['MCP_OAUTH_ISSUER'];

  const { NestFactory } = await import('@nestjs/core');
  const { getConnectionToken } = await import('@nestjs/mongoose');
  const { AppModule } = await import('../apps/api/src/app/app.module');
  const { configureApp } = await import('../apps/api/src/app/configure-app');
  const { loadConfig } = await import('../apps/api/src/config/configuration');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error'] });
  configureApp(app, loadConfig());
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api`;
  const db = app.get<Connection>(getConnectionToken());
  if (!db.name.startsWith('lp-int-')) throw new Error(`Refusing to run against database ${db.name}.`);

  const call: TestApi['call'] = async (who, method, path, body, headers = {}) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(who ? { authorization: `Bearer ${who.accessToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      // not JSON; keep the text
    }
    return { status: response.status, body: parsed as never };
  };

  const account: TestApi['account'] = async (name = 'person') => {
    const email = `${name}-${randomUUID().slice(0, 8)}@int.test`;
    const password = `pw-${randomUUID()}`;
    const registered = await call(null, 'POST', '/auth/register', { email, password, name });
    if (registered.status >= 300) throw new Error(`register ${registered.status}: ${JSON.stringify(registered.body)}`);
    await db.collection('users').updateOne({ email }, { $set: { cohort: 'internal' } });
    const login = await call<{ accessToken: string; refreshToken: string }>(null, 'POST', '/auth/login', { email, password });
    const sub = JSON.parse(Buffer.from(login.body.accessToken.split('.')[1], 'base64url').toString()).sub as string;
    return { id: sub, email, accessToken: login.body.accessToken, refreshToken: login.body.refreshToken };
  };

  return {
    url,
    app,
    db,
    call,
    account,
    async close() {
      await db.dropDatabase();
      await app.close();
    },
  };
}
