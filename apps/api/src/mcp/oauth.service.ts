import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Router, urlencoded, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidRequestError, InvalidScopeError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { AuthService } from '../auth/auth.service';
import { CONFIG, type AppConfig } from '../config/configuration';
import { McpOAuthClient, McpOAuthCredential } from './oauth.schema';
import { consentPage } from './oauth-page';

export const NUTRITION_SCOPE = 'nutrition';
const ACCESS_SECONDS = 3600;
const REFRESH_SECONDS = 30 * 24 * 3600;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

@Injectable()
export class McpOAuthService implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(
    @InjectModel(McpOAuthClient.name) private readonly clients: Model<McpOAuthClient>,
    @InjectModel(McpOAuthCredential.name) private readonly credentials: Model<McpOAuthCredential>,
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.clientsStore = {
      getClient: async (clientId) => {
        const row = await this.clients.findOne({ clientId }).lean();
        return row ? this.decryptClient(row.metadata) : undefined;
      },
      registerClient: async (metadata) => {
        if (!['none', 'client_secret_post'].includes(metadata.token_endpoint_auth_method ?? 'client_secret_post')) {
          throw new InvalidClientMetadataError('Use none or client_secret_post for token endpoint authentication.');
        }
        for (const value of metadata.redirect_uris) {
          const uri = new URL(value);
          if (uri.hash || uri.username || uri.password ||
              (uri.protocol !== 'https:' && !(uri.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname)))) {
            throw new InvalidClientMetadataError('Redirect URIs must use HTTPS, or HTTP loopback for native apps.');
          }
        }
        const client: OAuthClientInformationFull = {
          ...metadata, client_id: randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        await this.clients.create({ clientId: client.client_id, metadata: this.encryptClient(client) });
        return client;
      },
    };
  }

  get enabled(): boolean { return Boolean(this.config.mcpOAuthIssuer); }
  get issuer(): string { return new URL(this.config.mcpOAuthIssuer as string).href; }
  get resource(): string { return new URL('/api/mcp', this.issuer).href; }
  get metadataUrl(): string { return new URL('/.well-known/oauth-protected-resource/api/mcp', this.issuer).href; }

  /** Mounted at the origin root, outside Nest's /api prefix. SDK handlers validate OAuth DTOs. */
  router(): Router {
    const router = Router();
    router.use('/oauth/consent', (_req, res, next) => {
      res.set({
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      });
      next();
    });
    router.get('/oauth/consent', async (req, res) => {
      const ticket = typeof req.query['ticket'] === 'string' ? req.query['ticket'] : '';
      const pending = await this.pendingRequest(ticket, req);
      if (!pending) { res.status(400).send('This connection request has expired. Start again from your assistant.'); return; }
      res.type('html').send(consentPage(ticket, new URL(pending.redirectUri as string).origin));
    });
    router.post('/oauth/consent',
      rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }),
      urlencoded({ extended: false, limit: '8kb' }),
      async (req, res) => {
        // The browser-bound ticket plus exact Origin check prevents login/consent CSRF.
        if (req.headers.origin !== new URL(this.issuer).origin) { res.status(403).send('Invalid form origin.'); return; }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const ticket = typeof body['ticket'] === 'string' ? body['ticket'] : '';
        const pending = await this.pendingRequest(ticket, req);
        if (!pending) { res.status(400).send('This connection request has expired. Start again from your assistant.'); return; }
        const redirect = new URL(pending.redirectUri as string);
        if (pending.state !== undefined) redirect.searchParams.set('state', pending.state);
        if (body['cancel'] === 'yes') {
          await this.credentials.deleteOne({ key: pending.key, kind: 'pending' });
          redirect.searchParams.set('error', 'access_denied');
          res.redirect(303, redirect.href);
          return;
        }
        const email = body['email'];
        const password = body['password'];
        if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 256) {
          res.status(400).send('Enter your email and password.'); return;
        }
        let userId: string;
        try {
          const user = await this.auth.authenticateCredentials({ email, password });
          userId = String(user._id);
        } catch (error) {
          if (!(error instanceof Error) || !('getStatus' in error) ||
              (error as { getStatus(): number }).getStatus() !== 401) throw error;
          res.status(401).type('html').send(consentPage(ticket, redirect.origin, 'Incorrect email or password.'));
          return;
        }
        // Consume atomically so a double submission cannot issue two authorization codes.
        const consumed = await this.credentials.findOneAndDelete({ key: pending.key, kind: 'pending', expiresAt: { $gt: new Date() } }).lean();
        if (!consumed) { res.status(400).send('This connection request has already been used.'); return; }
        const code = secret();
        await this.credentials.create({
          ...this.binding(consumed), key: hash(code), kind: 'code', userId,
          expiresAt: new Date(Date.now() + 60_000), grantId: randomUUID(),
        });
        redirect.searchParams.set('code', code);
        res.clearCookie('lp_oauth', { path: '/oauth/consent' });
        res.redirect(303, redirect.href);
      });
    router.use(mcpAuthRouter({
      provider: this, issuerUrl: new URL(this.issuer), resourceServerUrl: new URL(this.resource),
      scopesSupported: [NUTRITION_SCOPE], resourceName: 'Life Portal nutrition',
    }));
    // Also support clients probing the origin-wide protected resource metadata URL.
    router.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({
      resource: this.resource, authorization_servers: [this.issuer], scopes_supported: [NUTRITION_SCOPE],
    }));
    return router;
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    this.validateResource(params.resource);
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidRequestError('An S256 PKCE challenge is required.');
    const scopes = params.scopes?.length ? params.scopes : [NUTRITION_SCOPE];
    if (scopes.some((scope) => scope !== NUTRITION_SCOPE)) throw new InvalidScopeError('Only nutrition access is supported.');
    const ticket = secret();
    const browser = secret();
    await this.credentials.create({
      key: hash(ticket), kind: 'pending', clientId: client.client_id, scopes,
      resource: this.resource, redirectUri: params.redirectUri, codeChallenge: params.codeChallenge,
      state: params.state, browserHash: hash(browser), expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    res.cookie('lp_oauth', browser, {
      httpOnly: true, secure: new URL(this.issuer).protocol === 'https:',
      sameSite: 'lax', path: '/oauth/consent', maxAge: 10 * 60_000,
    });
    res.redirect(303, `/oauth/consent?ticket=${encodeURIComponent(ticket)}`);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    const row = await this.lookup(code, 'code', client.client_id);
    if (!row?.codeChallenge) throw new InvalidGrantError('Invalid or expired authorization code.');
    return row.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    this.validateResource(resource);
    const row = await this.credentials.findOneAndDelete({
      key: hash(code), kind: 'code', clientId: client.client_id,
      redirectUri: redirectUri ?? '', resource: this.resource, expiresAt: { $gt: new Date() },
    }).lean();
    if (!row) throw new InvalidGrantError('Invalid, expired or already used authorization code.');
    return this.issueTokens(row);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    // Refresh may omit resource and inherit the original grant (RFC 8707). It may never
    // switch audiences, even if the client supplies a new resource explicitly.
    if (resource) this.validateResource(resource);
    const row = await this.lookup(refreshToken, 'refresh', client.client_id);
    if (!row || row.resource !== this.resource || (scopes && scopes.some((scope) => !row.scopes.includes(scope)))) throw new InvalidGrantError('Invalid refresh token or scopes.');
    const consumed = await this.credentials.findOneAndDelete({ key: row.key, kind: 'refresh', expiresAt: { $gt: new Date() } }).lean();
    if (!consumed) throw new InvalidGrantError('Refresh token already used. Reconnect Life Portal.');
    return this.issueTokens({ ...consumed, scopes: scopes ?? consumed.scopes });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await this.lookup(token, 'access');
    if (!row?.userId || row.resource !== this.resource || !row.scopes.includes(NUTRITION_SCOPE)) throw new InvalidTokenError('Invalid or expired nutrition access token.');
    await this.auth.findById(row.userId);
    return { token, clientId: row.clientId, scopes: row.scopes, expiresAt: Math.floor(row.expiresAt.getTime() / 1000), resource: new URL(row.resource), extra: { userId: row.userId } };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const row = await this.credentials.findOne({ key: hash(request.token), clientId: client.client_id, kind: { $in: ['access', 'refresh'] } }).lean();
    if (row?.grantId) await this.credentials.deleteMany({ grantId: row.grantId, clientId: client.client_id });
  }

  async revokeUser(userId: string): Promise<{ success: true }> {
    await this.credentials.deleteMany({ userId });
    return { success: true };
  }

  private validateResource(resource?: URL): void {
    if (resource?.href !== this.resource) throw new InvalidRequestError('resource must match the Life Portal MCP URL.');
  }

  private lookup(token: string, kind: string, clientId?: string) {
    return this.credentials.findOne({
      key: hash(token), kind, ...(clientId ? { clientId } : {}), expiresAt: { $gt: new Date() },
    }).lean();
  }

  private async pendingRequest(ticket: string, req: Request) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
    const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('lp_oauth='))?.slice('lp_oauth='.length);
    if (!cookie) return null;
    return this.credentials.findOne({ key: hash(ticket), kind: 'pending', browserHash: hash(cookie), expiresAt: { $gt: new Date() } }).lean();
  }

  private binding(row: McpOAuthCredential) {
    return { clientId: row.clientId, resource: row.resource, scopes: row.scopes, userId: row.userId, grantId: row.grantId, redirectUri: row.redirectUri, codeChallenge: row.codeChallenge };
  }

  private async issueTokens(row: McpOAuthCredential): Promise<OAuthTokens> {
    if (!row.userId) throw new InvalidGrantError('Missing account.');
    await this.auth.findById(row.userId);
    const access = secret();
    const refresh = secret();
    await this.credentials.insertMany([
      { ...this.binding(row), key: hash(access), kind: 'access', expiresAt: new Date(Date.now() + ACCESS_SECONDS * 1000) },
      { ...this.binding(row), key: hash(refresh), kind: 'refresh', expiresAt: new Date(Date.now() + REFRESH_SECONDS * 1000) },
    ]);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: ACCESS_SECONDS, scope: row.scopes.join(' ') };
  }

  private encryptClient(client: OAuthClientInformationFull): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(this.config.jwtSecret).digest(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(client), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }

  private decryptClient(value: string): OAuthClientInformationFull {
    const data = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(this.config.jwtSecret).digest(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as OAuthClientInformationFull;
  }
}
