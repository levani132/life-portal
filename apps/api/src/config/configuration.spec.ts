import { googleConfig, mailConfig, imageCheckConfig, storageConfig, webBaseUrl } from './configuration';

describe('storageConfig', () => {
  const full = {
    R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
    R2_BUCKET: 'life-portal-media',
    R2_ACCESS_KEY_ID: 'id',
    R2_SECRET_ACCESS_KEY: 'secret',
  };
  it('is off when nothing is set, and normalises the endpoint when everything is', () => {
    expect(storageConfig({})).toBeUndefined();
    expect(storageConfig(full)).toEqual({
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      bucket: 'life-portal-media',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
    });
  });
  it('refuses a partial or unsafe configuration', () => {
    expect(() => storageConfig({ ...full, R2_BUCKET: '' })).toThrow(/missing R2_BUCKET/);
    expect(() => storageConfig({ ...full, R2_ENDPOINT: 'http://acct.example' })).toThrow(/HTTPS/);
    expect(() => storageConfig({ ...full, R2_BUCKET: 'Bad_Name' })).toThrow(/bucket name/);
  });
});

describe('webBaseUrl and mailConfig (issue #27)', () => {
  it('requires HTTPS outside loopback and strips the trailing slash', () => {
    expect(webBaseUrl({ WEB_BASE_URL: 'https://portal.example.com/' })).toBe('https://portal.example.com');
    expect(webBaseUrl({ WEB_BASE_URL: 'http://localhost:4200' })).toBe('http://localhost:4200');
    expect(() => webBaseUrl({ WEB_BASE_URL: 'http://portal.example.com' })).toThrow('HTTPS');
    expect(() => webBaseUrl({ WEB_BASE_URL: 'https://portal.example.com/?x=1' })).toThrow();
    expect(webBaseUrl({})).toBeUndefined();
  });

  it('configures Resend only with a key and a sender, and never guesses a provider', () => {
    expect(mailConfig({}, undefined)).toBeUndefined();
    expect(() => mailConfig({ RESEND_API_KEY: 'k' }, undefined)).toThrow('MAIL_PROVIDER');
    expect(() => mailConfig({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' }, undefined)).toThrow('MAIL_FROM');
    expect(mailConfig({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'Life Portal <no-reply@example.com>' }, undefined)).toEqual({
      provider: 'resend',
      apiKey: 'k',
      from: 'Life Portal <no-reply@example.com>',
    });
  });

  it('refuses the development sink anywhere but loopback', () => {
    expect(mailConfig({ MAIL_PROVIDER: 'dev' }, 'http://localhost:4200')?.provider).toBe('dev');
    expect(() => mailConfig({ MAIL_PROVIDER: 'dev' }, 'https://portal.example.com')).toThrow('never run in production');
    expect(() => mailConfig({ MAIL_PROVIDER: 'dev' }, undefined)).toThrow();
  });
});

describe('googleConfig (issue #28)', () => {
  const full = {
    GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
    API_PUBLIC_URL: 'https://life-portal-api.onrender.com/',
  };
  const web = 'https://portal.example.com';

  it('is off when no Google variable is set, and builds the exact redirect URI otherwise', () => {
    expect(googleConfig({}, web)).toBeUndefined();
    expect(googleConfig(full, web)).toEqual({
      clientId: full.GOOGLE_CLIENT_ID,
      clientSecret: 'secret',
      redirectUri: 'https://life-portal-api.onrender.com/api/auth/google/callback',
    });
  });

  it('refuses a partial or unsafe setup', () => {
    expect(() => googleConfig({ GOOGLE_CLIENT_ID: full.GOOGLE_CLIENT_ID }, web)).toThrow('GOOGLE_CLIENT_SECRET');
    expect(() => googleConfig(full, undefined)).toThrow('WEB_BASE_URL');
    expect(() => googleConfig({ ...full, API_PUBLIC_URL: 'http://api.example.com' }, web)).toThrow('HTTPS');
    expect(() => googleConfig({ ...full, API_PUBLIC_URL: 'https://api.example.com/api' }, web)).toThrow();
    expect(() => googleConfig({ ...full, GOOGLE_CLIENT_ID: 'oops' }, web)).toThrow('googleusercontent');
  });

  it('allows a fake Google only on loopback', () => {
    const local = { ...full, API_PUBLIC_URL: 'http://127.0.0.1:3333', GOOGLE_OIDC_TEST_BASE: 'http://127.0.0.1:9999/' };
    expect(googleConfig(local, 'http://localhost:4200')?.endpoints?.token).toBe('http://127.0.0.1:9999/token');
    expect(() => googleConfig({ ...full, GOOGLE_OIDC_TEST_BASE: 'http://127.0.0.1:9999' }, web)).toThrow('loopback');
    expect(() => googleConfig({ ...local, GOOGLE_OIDC_TEST_BASE: 'https://evil.example.com' }, web)).toThrow('loopback');
  });

  it('checks photos only with a provider and its key, and refuses a provider it does not know', () => {
    expect(imageCheckConfig({})).toBeUndefined();
    expect(imageCheckConfig({ OPENAI_API_KEY: 'k' })).toBeUndefined();
    expect(imageCheckConfig({ IMAGE_CHECK_PROVIDER: 'OpenAI', OPENAI_API_KEY: ' k ' })).toEqual({ provider: 'openai', apiKey: 'k' });
    expect(() => imageCheckConfig({ IMAGE_CHECK_PROVIDER: 'openai' })).toThrow('OPENAI_API_KEY');
    expect(() => imageCheckConfig({ IMAGE_CHECK_PROVIDER: 'other', OPENAI_API_KEY: 'k' })).toThrow('must be "openai"');
  });
});
