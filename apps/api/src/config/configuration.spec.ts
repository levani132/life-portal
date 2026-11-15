import { mailConfig, storageConfig, webBaseUrl } from './configuration';

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
