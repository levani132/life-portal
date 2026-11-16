import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Issue #29: Vercel reads `vercel.json` only from the project's Root Directory. Production builds
 * with Root Directory `apps/web`, so the `/api` proxy route must be in `apps/web/vercel.json`; the
 * repo-root copy serves a project rooted at the repository. Exactly one is read, so they must not
 * drift apart.
 */
const read = (path: string) => JSON.parse(readFileSync(join(__dirname, path), 'utf8'));
const web = read('../../vercel.json');
const root = read('../../../../vercel.json');

describe('vercel.json', () => {
  it('has the same /api route at the repo root and in apps/web', () => {
    expect(web.routes).toEqual(root.routes);
  });

  it('forwards /api to the API with the proxy secret from the environment', () => {
    const [route] = web.routes;
    expect(route.src).toBe('^/api/(.*)$');
    expect(route.dest).toMatch(/^https:\/\/[^/]+\/api\/\$1$/);
    expect(route.transforms).toEqual([
      expect.objectContaining({ type: 'request.headers', op: 'set', target: { key: 'x-lp-proxy' }, args: '$LP_PROXY_SECRET', env: ['LP_PROXY_SECRET'] }),
    ]);
  });

  it('leaves the build to the Vercel project settings in apps/web', () => {
    expect(Object.keys(web).sort()).toEqual(['$schema', 'routes']);
  });
});
