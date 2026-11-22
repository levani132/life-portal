import { ForbiddenException } from '@nestjs/common';
import { ACCOUNT_PLAN } from '../account/account-plan';
import { USAGE_SOURCES, UsageService, type UsageStore } from './usage.module';

const TODAY = '2026-11-22';
const DEV = 'dev';
const access = {
  requireDeveloper: (id: string) => {
    if (id !== DEV) throw new ForbiddenException();
  },
};

describe('UsageService', () => {
  it('reads only collections that exist, and only who and when', () => {
    for (const source of USAGE_SOURCES) {
      expect(source.collection in ACCOUNT_PLAN).toBe(true);
      expect(!!source.day !== !!source.at).toBe(true);
    }
  });

  it('turns each source into its kind and reports counts with no id', async () => {
    const asked: string[] = [];
    const store: UsageStore = {
      accounts: async () => 4,
      signups: async () => [
        { userId: 'u1', day: '2026-11-21' },
        { userId: 'old', day: '2026-08-01' },
      ],
      pairs: async (source, since) => {
        asked.push(source.collection + ':' + since);
        if (source.collection === 'meal_entries') return [{ userId: 'u1', day: TODAY }, { userId: 'u2', day: TODAY }];
        if (source.collection === 'workout_sessions') return [{ userId: 'u1', day: TODAY }];
        if (source.collection === 'messages') return [{ userId: 'u3', day: '2026-11-20' }, { userId: 'u3', day: '2026-08-01' }];
        return [];
      },
    };
    const service = new UsageService(store, access as never);
    await expect(service.report('someone', 7, TODAY)).rejects.toBeInstanceOf(ForbiddenException);
    const report = await service.report(DEV, 7, TODAY);
    // The look-back covers retention (90 days) whatever range is shown.
    expect(asked).toHaveLength(USAGE_SOURCES.length);
    expect(asked.every((entry) => entry.endsWith(':2026-08-25'))).toBe(true);
    expect(report).toMatchObject({ totalAccounts: 4, newAccounts: 1, activeToday: 2, active7: 3, newAccountsActivated: 1 });
    expect(report.people).toEqual({ food: 2, training: 1, weight: 0, post: 0, social: 1 });
    expect(JSON.stringify(report)).not.toMatch(/u1|u2|u3|old/);
  });
});
