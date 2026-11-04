import { storageConfig } from './configuration';

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
