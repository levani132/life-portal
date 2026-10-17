import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import type { Model } from 'mongoose';
import { UnauthorizedException } from '@nestjs/common';
import type { AuthService } from '../auth/auth.service';
import type { AppConfig } from '../config/configuration';
import { McpOAuthService } from './oauth.service';
import { McpOAuthClient, McpOAuthCredential } from './oauth.schema';

/** Minimal query double; HTTP tests exercise the real SDK handlers, PKCE and consent. */
function store<T extends object>() {
  const rows: Record<string, unknown>[] = [];
  const match = (row: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$gt' in value) return (row[key] as Date) > (value.$gt as Date);
      if (value && typeof value === 'object' && '$in' in value) return (value.$in as unknown[]).includes(row[key]);
      return row[key] === value;
    });
  const model = {
    create: async (row: Record<string, unknown>) => { rows.push({ ...row }); return row; },
    insertMany: async (values: Record<string, unknown>[]) => { rows.push(...values); },
    findOne: (filter: Record<string, unknown>) => ({ lean: async () => rows.find((row) => match(row, filter)) ?? null }),
    findOneAndDelete: (filter: Record<string, unknown>) => ({ lean: async () => {
      const i = rows.findIndex((row) => match(row, filter));
      return i < 0 ? null : rows.splice(i, 1)[0];
    } }),
    deleteOne: async (filter: Record<string, unknown>) => { const i = rows.findIndex((row) => match(row, filter)); if (i >= 0) rows.splice(i, 1); },
    deleteMany: async (filter: Record<string, unknown>) => { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], filter)) rows.splice(i, 1); },
  };
  return { rows, model: model as unknown as Model<T> };
}

describe('MCP OAuth HTTP flow', () => {
  let server: Server;
  let origin: string;
  let provider: McpOAuthService;
  let clients: ReturnType<typeof store<McpOAuthClient>>;
  let credentials: ReturnType<typeof store<McpOAuthCredential>>;
  const verifier = 'a'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const callback = 'https://chatgpt.com/connector/oauth/test';
  const authenticateCredentials = jest.fn(async ({ password }: { password: string }) => {
    if (password !== 'correct-test-password') throw new UnauthorizedException();
    return { _id: 'owner-1' };
  });

  beforeEach(async () => {
    clients = store<McpOAuthClient>();
    credentials = store<McpOAuthCredential>();
    const app = express();
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    origin = `http://127.0.0.1:${address.port}`;
    provider = new McpOAuthService(clients.model, credentials.model, {
      authenticateCredentials, findById: jest.fn(async () => ({ id: 'owner-1' })),
    } as unknown as AuthService, { mcpOAuthIssuer: origin, jwtSecret: 'test-secret-'.repeat(4) } as AppConfig);
    app.use(provider.router());
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

  async function register() {
    const response = await fetch(`${origin}/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [callback], token_endpoint_auth_method: 'none' }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { client_id: string };
  }
  async function begin(clientId: string, overrides: Record<string, string> = {}) {
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope: 'nutrition', state: 'original-state', resource: provider.resource, ...overrides });
    const response = await fetch(`${origin}/authorize?${params}`, { redirect: 'manual' });
    return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '', location: response.headers.get('location') ?? '' };
  }
  async function approve(clientId: string) {
    const start = await begin(clientId);
    expect(start.response.status).toBe(303);
    const page = await fetch(`${origin}${start.location}`, { headers: { Cookie: start.cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Sign in and allow nutrition access');
    const ticket = new URL(start.location, origin).searchParams.get('ticket')!;
    const response = await fetch(`${origin}/oauth/consent`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: start.cookie },
      body: new URLSearchParams({ ticket, email: 'owner@example.com', password: 'correct-test-password' }),
    });
    expect(response.status).toBe(303);
    const callbackUrl = new URL(response.headers.get('location')!);
    expect(callbackUrl.searchParams.get('state')).toBe('original-state');
    return callbackUrl.searchParams.get('code')!;
  }
  function token(fields: Record<string, string>) {
    return fetch(`${origin}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  }

  it('advertises discovery, PKCE, resource and dynamic registration', async () => {
    const metadata = await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json();
    expect(metadata).toMatchObject({ issuer: `${origin}/`, code_challenge_methods_supported: ['S256'], registration_endpoint: `${origin}/register` });
    const resource = await (await fetch(`${origin}/.well-known/oauth-protected-resource/api/mcp`)).json();
    expect(resource.resource).toBe(provider.resource);
  });

  it('signs in, enforces PKCE/client/redirect/resource, prevents replay, rotates and revokes', async () => {
    const client = await register();
    const other = await register();
    const code = await approve(client.client_id);
    const fields = { grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: verifier, redirect_uri: callback, resource: provider.resource };
    expect((await token({ ...fields, code_verifier: 'b'.repeat(64) })).status).toBe(400);
    expect((await token({ ...fields, client_id: other.client_id })).status).toBe(400);
    expect((await token({ ...fields, redirect_uri: 'https://evil.example/callback' })).status).toBe(400);
    expect((await token({ ...fields, resource: 'https://evil.example/mcp' })).status).toBe(400);
    const response = await token(fields);
    expect(response.status).toBe(200);
    const tokens = await response.json();
    expect((await provider.verifyAccessToken(tokens.access_token)).extra?.['userId']).toBe('owner-1');
    expect((await token(fields)).status).toBe(400);
    const refresh = { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: provider.resource };
    expect((await token({ ...refresh, client_id: other.client_id })).status).toBe(400);
    expect((await token({ ...refresh, scope: 'finance' })).status).toBe(400);
    const rotated = await (await token(refresh)).json();
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect((await token(refresh)).status).toBe(400);
    expect((await fetch(`${origin}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id, token: rotated.refresh_token }) })).status).toBe(200);
    await expect(provider.verifyAccessToken(rotated.access_token)).rejects.toThrow();
    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow();
    // No raw bearer credentials are retained in database records.
    expect(JSON.stringify(credentials.rows)).not.toContain(tokens.access_token);
  });

  it('binds consent to the browser, rejects foreign origins and allows cancellation', async () => {
    const client = await register();
    const start = await begin(client.client_id);
    expect((await fetch(`${origin}${start.location}`)).status).toBe(400);
    const ticket = new URL(start.location, origin).searchParams.get('ticket')!;
    const submit = (originHeader: string, fields: Record<string, string>) => fetch(`${origin}/oauth/consent`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: originHeader, Cookie: start.cookie }, body: new URLSearchParams({ ticket, ...fields }) });
    expect((await submit('https://evil.example', { cancel: 'yes' })).status).toBe(403);
    expect((await submit(origin, { email: 'owner@example.com', password: 'wrong' })).status).toBe(401);
    const cancelled = await submit(origin, { cancel: 'yes' });
    expect(new URL(cancelled.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
    expect((await fetch(`${origin}${start.location}`, { headers: { Cookie: start.cookie } })).status).toBe(400);
  });

  it('rejects unknown scopes, resource substitution and unregistered redirects', async () => {
    const client = await register();
    for (const change of [{ scope: 'finance' }, { resource: 'https://evil.example/api/mcp' }, { code_challenge_method: 'plain' }]) {
      const result = await begin(client.client_id, change);
      expect(result.response.status).toBe(302);
      expect(new URL(result.location).searchParams.has('error')).toBe(true);
    }
    expect((await begin(client.client_id, { redirect_uri: 'https://evil.example' })).response.status).toBe(400);
  });

  it('keeps client registration encrypted and rejects unsafe redirects', async () => {
    const client = await register();
    const reloaded = new McpOAuthService(clients.model, credentials.model, {} as AuthService, { mcpOAuthIssuer: origin, jwtSecret: 'test-secret-'.repeat(4) } as AppConfig);
    expect((await reloaded.clientsStore.getClient(client.client_id))?.redirect_uris).toEqual([callback]);
    expect(clients.rows[0]['metadata']).not.toContain(callback);
    const response = await fetch(`${origin}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/callback'], token_endpoint_auth_method: 'none' }) });
    expect(response.status).toBe(400);
  });

  it('rejects expired credentials before Mongo TTL cleanup', async () => {
    const client = await register();
    const code = await approve(client.client_id);
    const row = credentials.rows.find((item) => item['kind'] === 'code')!;
    row['expiresAt'] = new Date(0);
    expect((await token({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: verifier, redirect_uri: callback, resource: provider.resource })).status).toBe(400);
  });
});
