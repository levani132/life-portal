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
    user?: { cohort?: string; featureOverrides?: object } | null;
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
  it('gives the configured developer everything without reading a cohort policy', async () => {
    const f = fixture({ user: { cohort: 'production' } });
    const { cohort, access } = await f.service.forUser(DEV);
    expect(cohort).toBe('developer');
    expect(Object.values(access).every(Boolean)).toBe(true);
    expect(f.policies.findOne).not.toHaveBeenCalled();
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
