import { Inject, Injectable } from '@nestjs/common';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { CONFIG, type AppConfig, type GoogleConfig } from '../../config/configuration';

/** The ID-token claims this app uses, after every check passed. */
export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export class GoogleTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleTokenError';
  }
}

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Talks to Google (issue #28) through `google-auth-library`: the authorization URL, the
 * server-side code exchange with PKCE, and the ID token's signature, issuer, audience and
 * expiry. This class adds the nonce check. Google's access and refresh tokens are dropped on
 * the spot: nothing here calls a Google API.
 */
@Injectable()
export class GoogleOidc {
  private readonly client?: OAuth2Client;
  private readonly config?: GoogleConfig;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.config = config.google;
    if (!this.config) return;
    const endpoints = this.config.endpoints;
    this.client = new OAuth2Client({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri,
      issuers: ISSUERS,
      // Node's own fetch. Left alone, gaxios lazy-imports node-fetch, which also fails under Jest.
      transporterOptions: { fetchImplementation: fetch },
      ...(endpoints
        ? {
            endpoints: {
              oauth2AuthBaseUrl: endpoints.auth,
              oauth2TokenUrl: endpoints.token,
              oauth2FederatedSignonPemCertsUrl: endpoints.certs,
            },
          }
        : {}),
    });
  }

  get enabled(): boolean {
    return Boolean(this.client);
  }

  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string; loginHint?: string }): string {
    return this.require().generateAuthUrl({
      response_type: 'code',
      scope: ['openid', 'email', 'profile'],
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: 'select_account',
      access_type: 'online',
      ...(input.loginHint ? { login_hint: input.loginHint } : {}),
    });
  }

  /** Exchanges the code and returns the verified claims. Throws `GoogleTokenError` on any doubt. */
  async exchange(code: string, codeVerifier: string, expectedNonce: string): Promise<GoogleClaims> {
    const client = this.require();
    let idToken: string | null | undefined;
    try {
      const { tokens } = await client.getToken({ code, codeVerifier });
      idToken = tokens.id_token;
    } catch {
      throw new GoogleTokenError('Google refused the code.');
    }
    if (!idToken) throw new GoogleTokenError('Google returned no ID token.');

    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: (this.config as GoogleConfig).clientId });
      payload = ticket.getPayload();
    } catch {
      throw new GoogleTokenError('The ID token did not verify.');
    }
    if (!payload?.sub || !payload.email) throw new GoogleTokenError('The ID token has no subject or email.');
    if (payload.nonce !== expectedNonce) throw new GoogleTokenError('The ID token nonce does not match.');
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name,
    };
  }

  private require(): OAuth2Client {
    if (!this.client) throw new Error('Continue with Google is not configured.');
    return this.client;
  }
}
