import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { pageAccess, resolveFeatureAccess } from '@life-portal/shared-domain';
import { ACT_MODE } from '../auth/acting';
import type { AppConfig } from '../config/configuration';
import { FakeModel } from '../training/fake-model.testing';
import { ActingGuard, PagesService, pageEmail } from './pages.module';

const DEV = new Types.ObjectId().toHexString();
const ANA = new Types.ObjectId().toHexString();
const BEKA = new Types.ObjectId().toHexString();

async function world(options: { pagesOff?: string[] } = {}) {
  const users = new FakeModel();
  for (const id of [DEV, ANA, BEKA]) await users.create({ _id: new Types.ObjectId(id), email: `${id}@example.com`, name: id });
  const profiles = new Map<string, { displayName: string; username: string; bio: string }>();
  const erased: string[] = [];
  const access = {
    forUser: async (id: string) => {
      const row = users.docs.find((doc) => String(doc['_id']) === id);
      const page = row?.['kind'] === 'page';
      const base = page ? pageAccess() : resolveFeatureAccess('internal', { pages: !options.pagesOff?.includes(id) });
      if (row?.['suspendedAt']) for (const key of Object.keys(base) as (keyof typeof base)[]) base[key] = false;
      return { cohort: 'internal', access: base, ...(page ? { page: true } : {}) };
    },
  };
  const social = {
    usernameFree: async (username: string) => ![...profiles.values()].some((profile) => profile.username === username),
    createPageProfile: async (id: string, input: { displayName: string; username: string; bio: string }) => {
      if ([...profiles.values()].some((profile) => profile.username === input.username)) throw new Error('raced');
      profiles.set(id, input);
    },
    update: async (id: string, dto: { displayName: string; username: string; bio: string }) => { profiles.set(id, { displayName: dto.displayName, username: dto.username, bio: dto.bio }); },
    setAiManaged: async () => undefined,
    summaries: async (ids: string[]) => new Map(ids.flatMap((id) => (profiles.has(id) ? [[id, profiles.get(id)!] as const] : []))),
  };
  const accounts = { erase: async (id: string) => { erased.push(id); } };
  const service = new PagesService(users as never, access as never, social as never, accounts as never, { developerUserId: DEV } as AppConfig, { followerCount: async () => 0 } as never, { registerPageResolver: () => undefined, register: () => undefined } as never, {} as never, {} as never);
  return { service, users, profiles, erased };
}

describe('PagesService', () => {
  it('creates a page nobody can sign in to, managed by its creator, with its own profile', async () => {
    const w = await world();
    const page = await w.service.create(ANA, { name: '  Ana’s Kitchen ', username: 'anas-kitchen', bio: ' Meals ' });
    expect(page).toMatchObject({ name: 'Ana’s Kitchen', username: 'anas-kitchen', bio: 'Meals', aiManaged: false, official: false, suspended: false });
    const row = w.users.docs.find((doc) => String(doc['_id']) === page.id)!;
    expect(row).toMatchObject({ kind: 'page', managers: [ANA], createdBy: ANA, email: pageEmail(page.id), roles: [] });
    expect(row['passwordHash']).toBeUndefined();
    expect(String(row['email'])).toMatch(/\.invalid$/);
    expect((await w.service.mine(ANA)).pages.map((one) => one.id)).toEqual([page.id]);
    expect((await w.service.mine(BEKA)).pages).toEqual([]);
  });

  it('holds a person to three pages, the developer to none, and a set limit to its number', async () => {
    const w = await world();
    for (const n of [1, 2, 3]) await w.service.create(ANA, { name: `P${n}`, username: `ana-${n}` });
    expect((await w.service.mine(ANA)).remaining).toBe(0);
    await expect(w.service.create(ANA, { name: 'P4', username: 'ana-4' })).rejects.toMatchObject({ response: { code: 'PAGE_LIMIT' } });
    w.users.docs.find((doc) => String(doc['_id']) === ANA)!['pageLimit'] = 5;
    await w.service.create(ANA, { name: 'P4', username: 'ana-4' });
    expect((await w.service.mine(ANA)).remaining).toBe(1);
    for (const n of [1, 2, 3, 4, 5]) await w.service.create(DEV, { name: `D${n}`, username: `dev-${n}` });
    expect((await w.service.mine(DEV)).remaining).toBeNull();
  });

  it('refuses a username a person or a page already has, and leaves nothing half-made', async () => {
    const w = await world();
    await w.service.create(ANA, { name: 'One', username: 'taken' });
    await expect(w.service.create(BEKA, { name: 'Two', username: 'taken' })).rejects.toMatchObject({ response: { code: 'USERNAME_TAKEN' } });
    expect(w.users.docs.filter((doc) => doc['kind'] === 'page')).toHaveLength(1);
  });

  it('is closed while the feature is off for the person', async () => {
    const w = await world({ pagesOff: [BEKA] });
    await expect(w.service.create(BEKA, { name: 'X', username: 'beka-x' })).rejects.toMatchObject({ response: { code: 'PAGES_OFF' } });
    expect(await w.service.mine(BEKA)).toEqual({ pages: [], remaining: 0, assistant: false });
  });

  it('lets only a manager edit, delete or act as a page, with one answer for not-yours and not-there', async () => {
    const w = await world();
    const page = await w.service.create(ANA, { name: 'One', username: 'one' });
    const edit = { name: 'Renamed', username: 'one', bio: 'b', aiManaged: true };
    await expect(w.service.update(BEKA, page.id, edit)).rejects.toMatchObject({ response: { code: 'NOT_A_MANAGER' } });
    await expect(w.service.remove(BEKA, page.id)).rejects.toMatchObject({ response: { code: 'NOT_A_MANAGER' } });
    await expect(w.service.actingAs(BEKA, page.id)).rejects.toMatchObject({ response: { code: 'NOT_A_MANAGER' } });
    await expect(w.service.actingAs(ANA, new Types.ObjectId().toHexString())).rejects.toMatchObject({ response: { code: 'NOT_A_MANAGER' } });
    await expect(w.service.actingAs(ANA, 'not-an-id')).rejects.toMatchObject({ response: { code: 'NOT_A_MANAGER' } });
    // A person is not a page: nobody acts as another person.
    await expect(w.service.actingAs(ANA, BEKA)).rejects.toMatchObject({ response: { code: 'NOT_A_MANAGER' } });

    expect(await w.service.actingAs(ANA, page.id)).toBe(page.id);
    expect(await w.service.update(ANA, page.id, edit)).toMatchObject({ name: 'Renamed', aiManaged: true });
    w.users.docs.find((doc) => String(doc['_id']) === page.id)!['suspendedAt'] = new Date();
    await expect(w.service.actingAs(ANA, page.id)).rejects.toMatchObject({ response: { code: 'PAGE_SUSPENDED' } });
    await w.service.remove(ANA, page.id);
    expect(w.erased).toEqual([page.id]);
  });

  it('says who a request is made as', async () => {
    const w = await world();
    const page = await w.service.create(ANA, { name: 'One', username: 'one' });
    expect(await w.service.identity({ userId: ANA, actorId: ANA } as never)).toEqual({ kind: 'person', id: ANA });
    expect(await w.service.identity({ userId: page.id, actorId: ANA } as never)).toMatchObject({ kind: 'page', id: page.id, personId: ANA, page: { username: 'one' } });
  });
});

describe('ActingGuard', () => {
  const context = (mode: string | undefined, headers: Record<string, string>, user?: object) => {
    const request = { headers, user };
    const handler = () => undefined;
    if (mode) Reflect.defineMetadata(ACT_MODE, mode, handler);
    return {
      request,
      ctx: { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => handler, getClass: () => class {} } as unknown as ExecutionContext,
    };
  };
  const pages = { actingAs: jest.fn(async (_person: string, page: string) => page) };
  const guard = new ActingGuard(new Reflector(), pages as never);
  const person = { userId: ANA, actorId: ANA, email: 'a', roles: [], sessionId: 's' };

  beforeEach(() => pages.actingAs.mockClear());

  it('does nothing without the header, and nothing on routes with no signed-in person', async () => {
    const plain = context('page', {}, person);
    expect(await guard.canActivate(plain.ctx)).toBe(true);
    expect(plain.request.user).toEqual(person);
    const tokenRoute = context(undefined, { 'x-lp-act-as': 'p1' }, undefined);
    expect(await guard.canActivate(tokenRoute.ctx)).toBe(true);
    expect(pages.actingAs).not.toHaveBeenCalled();
  });

  it('runs a route open to pages as the page, keeping the person as the actor', async () => {
    const acting = context('page', { 'x-lp-act-as': 'p1' }, person);
    expect(await guard.canActivate(acting.ctx)).toBe(true);
    expect(pages.actingAs).toHaveBeenCalledWith(ANA, 'p1');
    expect(acting.request.user).toMatchObject({ userId: 'p1', actorId: ANA });
  });

  it('ignores the header on a person route and refuses every other route', async () => {
    const personal = context('person', { 'x-lp-act-as': 'p1' }, person);
    expect(await guard.canActivate(personal.ctx)).toBe(true);
    expect(personal.request.user).toEqual(person);
    for (const mode of [undefined, 'none']) {
      await expect(guard.canActivate(context(mode, { 'x-lp-act-as': 'p1' }, person).ctx)).rejects.toMatchObject({ response: { code: 'NOT_FOR_PAGES' } });
    }
    expect(pages.actingAs).not.toHaveBeenCalled();
  });

  it('lets the refusal of a page that is not theirs through', async () => {
    pages.actingAs.mockRejectedValueOnce(new ForbiddenException({ code: 'NOT_A_MANAGER' }));
    await expect(guard.canActivate(context('page', { 'x-lp-act-as': 'p1' }, person).ctx)).rejects.toMatchObject({ response: { code: 'NOT_A_MANAGER' } });
  });
});

describe('what a page may use in Food and Training', () => {
  /** The route each `@ForPages()` marker in a file opens: the first route decorator after it. */
  const opened = (file: string) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    return [...source.matchAll(/@ForPages\(\)\s+@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g)].map((match) => `${match[1].toUpperCase()} ${match[2]}`);
  };

  it('is the library only: foods and saved meals, never the diary, weight, goals or logging', () => {
    const routes = opened('nutrition/nutrition.module.ts');
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) expect(route).toMatch(/^(GET|POST|PATCH|DELETE) (foods|meals)(\/|$)/);
    for (const route of routes) expect(route).not.toMatch(/log|from-day|entries|weigh|profile|cheat|summary/);
  });

  it('is exercises and plans only, never a workout, a set, a weigh-in, a level or a rank', () => {
    const routes = opened('training/training.module.ts');
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) expect(route).toMatch(/^(GET|POST|PUT|PATCH|DELETE) (exercises|plans)(\/|$)/);
    for (const route of routes) expect(route).not.toMatch(/sessions|sets|weigh|level|rank|history|progress|profile|summary/);
  });
});
