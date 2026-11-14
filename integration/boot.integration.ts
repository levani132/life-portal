import { startApi, type TestApi } from './harness';

describe('the API against a real MongoDB (issue #22)', () => {
  let api: TestApi;
  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(() => api?.close());

  it('boots, answers health and refuses an unauthenticated read', async () => {
    expect((await api.call(null, 'GET', '/health')).status).toBe(200);
    expect((await api.call(null, 'GET', '/training/sessions')).status).toBe(401);
  });

  it('registers an account in its own throwaway database', async () => {
    const person = await api.account();
    expect(api.db.name).toMatch(/^lp-int-/);
    expect((await api.call(person, 'GET', '/settings')).status).toBe(200);
  });
});
