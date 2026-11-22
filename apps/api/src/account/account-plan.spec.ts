import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNT_PLAN, FILE_COLLECTIONS } from './account-plan';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}

describe('the account plan', () => {
  const declared = new Set<string>();
  for (const file of sources(join(__dirname, '..'))) {
    if (file.includes(`${join('account', 'account-plan')}`)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(/collection: '([a-z_]+)'/g)) declared.add(match[1]);
  }

  it('says what happens to every collection the API declares', () => {
    expect(declared.size).toBeGreaterThan(60);
    const missing = [...declared].filter((name) => !(name in ACCOUNT_PLAN)).sort();
    // A new collection: decide whether it is owned, custom or kept, in account-plan.ts.
    expect(missing).toEqual([]);
  });

  it('lists nothing that no longer exists', () => {
    expect(Object.keys(ACCOUNT_PLAN).filter((name) => !declared.has(name)).sort()).toEqual([]);
  });

  it('only looks for files where the account is found by userId', () => {
    for (const name of FILE_COLLECTIONS) {
      const rule = ACCOUNT_PLAN[name];
      expect(rule.kind === 'custom' || (rule.kind === 'owned' && !rule.field)).toBe(true);
    }
  });
});
