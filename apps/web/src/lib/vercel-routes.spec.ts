import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Issue #29: Vercel reads `vercel.json` from the project's Root Directory only. This repo has one
 * at the repo root and one in `apps/web`, so the `/api` route is active whichever the project is
 * rooted at. They must not drift: a route in one file only is a route that silently does nothing.
 */
const read = (path: string) =>
  JSON.parse(readFileSync(join(__dirname, '../../../..', path), 'utf8')) as {
    routes?: unknown[];
  };

it('keeps the /api route identical in both vercel.json files', () => {
  const root = read('vercel.json');
  const web = read('apps/web/vercel.json');
  expect(root.routes?.length).toBeGreaterThan(0);
  expect(web.routes).toEqual(root.routes);
});

it('forwards /api to the API with the proxy secret taken from the environment, never written out', () => {
  const [route] = read('apps/web/vercel.json').routes as {
    src: string;
    dest: string;
    transforms: { args: string; env: string[] }[];
  }[];
  expect(new RegExp(route.src).test('/api/health')).toBe(true);
  expect(route.dest).toMatch(/^https:\/\/.+\/api\/\$1$/);
  expect(route.transforms[0]).toMatchObject({
    args: '$LP_PROXY_SECRET',
    env: ['LP_PROXY_SECRET'],
  });
});
