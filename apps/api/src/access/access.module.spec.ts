import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureId } from '@life-portal/shared-types';
import { AccessService, ModuleAccessGuard } from './access.module';

const DEV = '0123456789abcdef01234567';
const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function fixture(
  options: {
    user?: { cohort?: string; featureOverrides?: object; suspendedAt?: Date; kind?: 'page' } | null;
    policy?: { overrides: object } | null;
    developerUserId?: string;
  } = {},
) {
  const user = options.user === undefined ? {} : options.user;
  const users = {
    findById: jest.fn().mockReturnValue({
      select: () => ({ lean: jest.fn().mockResolvedValue(user) }),
    }),
    findByIdAndUpdate: jest.fn().mockResolvedValue({ _id: USER }),
    find: jest.fn(),
  };
  const policies = {
    findOne: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(options.policy ?? null) }),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
  };
  const config = {
    developerUserId:
      'developerUserId' in options ? options.developerUserId : DEV,
  };
  const service = new AccessService(
    users as never,
    config as never,
    policies as never,
  );
  return { users, policies, service };
}

describe('feature access resolution', () => {
  it('gives the configured developer everything except default-off features', async () => {
    const f = fixture({ user: { cohort: 'production' }, policy: { overrides: { money: false } } });
    const { cohort, access } = await f.service.forUser(DEV);
    expect(cohort).toBe('developer');
    expect(Object.entries(access).every(([id, on]) => on || id === 'forYouMetrics')).toBe(true);
    expect(access.forYouMetrics).toBe(false);
  });

  it('turns measurement on for the developer only with the internal group (#11)', async () => {
    const f = fixture({
      user: { cohort: 'production', featureOverrides: { forYouMetrics: true } },
      policy: { overrides: { forYouMetrics: true } },
    });
    expect((await f.service.forUser(DEV)).access.forYouMetrics).toBe(true);
    expect(f.policies.findOne).toHaveBeenCalledWith({ cohort: 'internal' });
    const off = fixture({ user: { cohort: 'production', featureOverrides: { forYouMetrics: true } } });
    // The developer's own stored overrides are not used; only the internal policy is.
    expect((await off.service.forUser(DEV)).access.forYouMetrics).toBe(false);
  });

  it('lets a user override beat the cohort policy', async () => {
    const f = fixture({
      user: { cohort: 'production', featureOverrides: { social: false } },
      policy: { overrides: { social: true, money: true } },
    });
    const { access } = await f.service.forUser(USER);
    expect(access.social).toBe(false);
    expect(access.money).toBe(true);
  });

  it('never grants the EPAM board to anyone but the developer', async () => {
    const f = fixture({
      user: { cohort: 'internal', featureOverrides: { epam: true } },
    });
    expect((await f.service.forUser(USER)).access.epam).toBe(false);
  });

  it('switches every feature off for a suspended account (spec 039)', async () => {
    const f = fixture({ user: { cohort: 'internal', suspendedAt: new Date() }, policy: { overrides: { social: true } } });
    const { access } = await f.service.forUser(USER);
    expect(Object.values(access).every((on) => on === false)).toBe(true);
    await expect(f.service.require(USER, 'social')).rejects.toThrow('not available');
  });

  it('gives a page its fixed features whatever the switches say, and none when suspended (spec 040)', async () => {
    const f = fixture({ user: { kind: 'page', cohort: 'production', featureOverrides: { money: true, social: false } }, policy: { overrides: { money: true } } });
    const who = await f.service.forUser(USER);
    expect(who.page).toBe(true);
    expect(who.access).toMatchObject({ social: true, foodPosts: true, nutrition: true, training: true, money: false, tournaments: false, pages: false });
    const gone = await fixture({ user: { kind: 'page', suspendedAt: new Date() } }).service.forUser(USER);
    expect(Object.values(gone.access).every((on) => on === false)).toBe(true);
  });

  it('answers the same for many accounts at once as for each alone (spec 041)', async () => {
    const policy = { cohort: 'production', overrides: { social: true, foodPosts: false } };
    const cases = [
      { _id: USER, cohort: 'production', featureOverrides: { foodPosts: true } },
      { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', cohort: 'production' },
      { _id: 'cccccccccccccccccccccccc', cohort: 'production', suspendedAt: new Date() },
      { _id: 'dddddddddddddddddddddddd', kind: 'page' as const, cohort: 'production' },
      { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', kind: 'page' as const, cohort: 'production', disabledAt: new Date() },
      { _id: DEV, cohort: 'production' },
    ];
    const f = fixture({ policy });
    f.users.find.mockReturnValue({ select: () => ({ lean: jest.fn().mockResolvedValue(cases) }) });
    f.policies.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([policy]) });
    const many = await f.service.forUsers([...cases.map((row) => row._id), 'not-an-id']);
    expect(many.size).toBe(cases.length);
    for (const row of cases) {
      const one = fixture({ user: row as never, policy });
      expect([row._id, many.get(row._id)]).toEqual([row._id, (await one.service.forUser(row._id)).access]);
    }
  });

  it('answers 401 for a deleted account and 403 for a module it lacks', async () => {
    await expect(fixture({ user: null }).service.forUser(USER)).rejects.toThrow(
      UnauthorizedException,
    );
    const f = fixture({ user: { cohort: 'production' } });
    await expect(f.service.require(USER, 'money')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(f.service.require(USER, 'nutrition')).resolves.toBeUndefined();
  });
});

describe('developer-only administration', () => {
  it('refuses everyone when no developer is configured', () => {
    const f = fixture({ developerUserId: undefined });
    expect(() => f.service.requireDeveloper('')).toThrow(ForbiddenException);
    expect(() => f.service.requireDeveloper(USER)).toThrow(ForbiddenException);
  });

  it('refuses a non-developer before touching any collection', async () => {
    const f = fixture();
    const dto = { cohort: 'internal' as const, overrides: {} };
    await expect(f.service.listUsers(USER)).rejects.toThrow(ForbiddenException);
    await expect(f.service.getPolicies(USER)).rejects.toThrow(ForbiddenException);
    await expect(f.service.updatePolicy(USER, dto)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(f.service.update(USER, USER, dto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(f.users.find).not.toHaveBeenCalled();
    expect(f.policies.find).not.toHaveBeenCalled();
    expect(f.policies.findOneAndUpdate).not.toHaveBeenCalled();
    expect(f.users.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('cannot change the developer account or a malformed id', async () => {
    const f = fixture();
    const dto = { cohort: 'production' as const, overrides: {} };
    await expect(f.service.update(DEV, DEV, dto)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(f.service.update(DEV, 'not-an-id', dto)).rejects.toThrow(
      NotFoundException,
    );
    expect(f.users.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('group policies', () => {
  it('returns a concrete value for every feature, stored values winning over the fallback', async () => {
    const f = fixture();
    f.policies.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { cohort: 'production', overrides: { nutrition: false, social: true } },
      ]),
    });
    const [production, internal] = await f.service.getPolicies(DEV);
    expect(production.cohort).toBe('production');
    expect(production.access.nutrition).toBe(false);
    expect(production.access.social).toBe(true);
    expect(production.access.money).toBe(false);
    expect(internal.access.money).toBe(true);
    expect(internal.access.epam).toBe(false);
  });
});

describe('module guard', () => {
  function context(user?: { userId: string }) {
    return {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }
  function guard(module: FeatureId | undefined, allowed: boolean) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(module),
    } as unknown as Reflector;
    const access = {
      require: jest
        .fn()
        .mockImplementation(async () => {
          if (!allowed) throw new ForbiddenException();
        }),
    };
    return { access, guard: new ModuleAccessGuard(reflector, access as never) };
  }

  it('lets an unmarked route through without a lookup', async () => {
    const g = guard(undefined, false);
    await expect(g.guard.canActivate(context({ userId: USER }))).resolves.toBe(true);
    expect(g.access.require).not.toHaveBeenCalled();
  });

  it('checks the session user for a marked route and fails closed', async () => {
    const g = guard('social', false);
    await expect(g.guard.canActivate(context({ userId: USER }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(g.access.require).toHaveBeenCalledWith(USER, 'social');
  });
});
