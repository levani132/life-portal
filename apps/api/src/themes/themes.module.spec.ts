import { ForbiddenException } from '@nestjs/common';
import { THEME_ROLE_IDS, THEME_V0, THEME_V0_ID } from '@life-portal/shared-types';
import { ThemesService } from './themes.module';

const DEV = '0123456789abcdef01234567';
const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

type Stored = { _id: string; name: string; version?: number; light: Record<string, string>; dark: Record<string, string>; updatedAt: Date };

/** Just enough of two collections for the service: one list of themes, one active id. */
function fixture(rows: Stored[] = [], activeId?: string) {
  const state = { rows: [...rows], activeId };
  const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });
  const themes = {
    findById: (id: string) => lean(state.rows.find((row) => row._id === id) ?? null),
    find: () => ({ sort: () => ({ limit: () => lean(state.rows) }) }),
    countDocuments: () => Promise.resolve(state.rows.length),
    create: (doc: Omit<Stored, '_id' | 'updatedAt'>) => {
      const row = { ...doc, _id: ID, updatedAt: new Date() };
      state.rows.push(row);
      return Promise.resolve({ toObject: () => row });
    },
    findOneAndUpdate: (filter: { _id: string; version?: number; $or?: unknown[] }, update: { $set: Partial<Stored> }) => {
      const row = state.rows.find((item) => item._id === filter._id);
      const matches = row && (filter.$or ? (row.version ?? 1) === 1 : row.version === filter.version);
      if (matches) Object.assign(row, update.$set);
      return lean(matches ? row : null);
    },
    deleteOne: ({ _id }: { _id: string }) => {
      state.rows = state.rows.filter((row) => row._id !== _id);
      return Promise.resolve();
    },
  };
  const settings = {
    findOne: () => lean(state.activeId ? { themeId: state.activeId } : null),
    findOneAndUpdate: (_: unknown, update: { $set: { themeId: string } }) => {
      state.activeId = update.$set.themeId;
      return Promise.resolve();
    },
  };
  const access = {
    requireDeveloper: (userId: string) => {
      if (userId !== DEV) throw new ForbiddenException('Developer access required.');
    },
  };
  return { state, service: new ThemesService(themes as never, settings as never, access as never) };
}

const stored = (over: Partial<Stored> = {}): Stored => ({
  _id: ID,
  name: 'Sharp',
  version: 1,
  light: { ...THEME_V0.light },
  dark: { ...THEME_V0.dark },
  updatedAt: new Date('2026-11-17T10:00:00Z'),
  ...over,
});

describe('themes', () => {
  it('answers v0 as the active theme when nothing was ever activated', async () => {
    const active = await fixture().service.active();
    expect(active).toEqual({ id: THEME_V0_ID, version: 1, light: THEME_V0.light, dark: THEME_V0.dark });
  });

  it('answers v0 when the active theme no longer exists', async () => {
    expect((await fixture([], ID).service.active()).id).toBe(THEME_V0_ID);
  });

  it('gives the active theme a colour for every role, even one saved before a role existed', async () => {
    const { ink: _ink, ...withoutInk } = THEME_V0.light;
    const active = await fixture([stored({ light: { ...withoutInk, surface: '255 255 255' } })], ID).service.active();
    expect(Object.keys(active.light).sort()).toEqual([...THEME_ROLE_IDS].sort());
    expect(active.light['ink']).toBe(THEME_V0.light['ink']);
    expect(active.light['surface']).toBe('255 255 255');
  });

  it('the active theme carries colours and nothing else', async () => {
    const active = await fixture([stored()], ID).service.active();
    expect(Object.keys(active).sort()).toEqual(['dark', 'id', 'light', 'version']);
  });

  it('lets only the developer list, create, change, delete or activate', async () => {
    const { service } = fixture([stored()]);
    await expect(service.list(USER)).rejects.toThrow(ForbiddenException);
    await expect(service.create(USER, { name: 'x' })).rejects.toThrow(ForbiddenException);
    await expect(service.update(USER, ID, { baseVersion: 1 })).rejects.toThrow(ForbiddenException);
    await expect(service.remove(USER, ID)).rejects.toThrow(ForbiddenException);
    await expect(service.activate(USER, ID)).rejects.toThrow(ForbiddenException);
  });

  it('lists v0 first, built in', async () => {
    const list = await fixture([stored()]).service.list(DEV);
    expect(list.activeId).toBe(THEME_V0_ID);
    expect(list.themes.map((theme) => [theme.id, theme.builtIn])).toEqual([[THEME_V0_ID, true], [ID, false]]);
  });

  it('creates a theme as a copy of v0', async () => {
    const theme = await fixture().service.create(DEV, { name: '  Sharp  ' });
    expect(theme).toMatchObject({ name: 'Sharp', version: 1, builtIn: false, light: THEME_V0.light, dark: THEME_V0.dark });
  });

  it('never changes or deletes v0', async () => {
    const { service } = fixture();
    await expect(service.update(DEV, THEME_V0_ID, { name: 'mine', baseVersion: 1 })).rejects.toMatchObject({ response: { code: 'THEME_BUILT_IN' } });
    await expect(service.remove(DEV, THEME_V0_ID)).rejects.toMatchObject({ response: { code: 'THEME_BUILT_IN' } });
  });

  it('saves the sent roles over the stored ones and bumps the version', async () => {
    const theme = await fixture([stored()]).service.update(DEV, ID, { light: { ink: '0 0 0' }, baseVersion: 1 });
    expect(theme.version).toBe(2);
    expect(theme.light['ink']).toBe('0 0 0');
    expect(theme.light['surface']).toBe(THEME_V0.light['surface']);
  });

  it('refuses anything that is not a colour for a known role', async () => {
    const { service } = fixture([stored()]);
    await expect(service.update(DEV, ID, { light: { ink: 'red;}body{display:none' }, baseVersion: 1 })).rejects.toThrow(/three numbers/);
    await expect(service.update(DEV, ID, { dark: { nope: '0 0 0' }, baseVersion: 1 })).rejects.toThrow(/not a colour role/);
  });

  it('refuses a stale edit and says what is there now', async () => {
    const { service } = fixture([stored({ version: 3 })]);
    await expect(service.update(DEV, ID, { name: 'late', baseVersion: 2 })).rejects.toMatchObject({
      response: { code: 'STALE_EDIT', current: { version: 3, name: 'Sharp' } },
    });
  });

  it('refuses to activate a theme whose text cannot be read, and keeps the active one', async () => {
    const { service, state } = fixture([stored({ light: { ...THEME_V0.light, ink: '250 250 250' } })]);
    await expect(service.activate(DEV, ID)).rejects.toMatchObject({ response: { code: 'THEME_UNREADABLE' } });
    expect(state.activeId).toBeUndefined();
  });

  it('refuses a save that would make the active theme unreadable', async () => {
    const { service } = fixture([stored()], ID);
    await expect(service.update(DEV, ID, { light: { ink: '250 250 250' }, baseVersion: 1 })).rejects.toMatchObject({
      response: { code: 'THEME_UNREADABLE' },
    });
  });

  it('activates a readable theme, and v0 again', async () => {
    const { service } = fixture([stored()]);
    expect((await service.activate(DEV, ID)).activeId).toBe(ID);
    expect((await service.active()).id).toBe(ID);
    expect((await service.activate(DEV, THEME_V0_ID)).activeId).toBe(THEME_V0_ID);
  });

  it('will not delete the active theme; deleting a missing one succeeds', async () => {
    const { service, state } = fixture([stored()], ID);
    await expect(service.remove(DEV, ID)).rejects.toMatchObject({ response: { code: 'THEME_ACTIVE' } });
    state.activeId = undefined;
    await expect(service.remove(DEV, ID)).resolves.toEqual({ success: true });
    await expect(service.remove(DEV, ID)).resolves.toEqual({ success: true });
  });

  it('adds a preset as an ordinary theme, and never activates a preset itself', async () => {
    const { service } = fixture();
    const theme = await service.create(DEV, { name: 'Crisp', from: 'preset:crisp' });
    expect(theme).toMatchObject({ id: ID, builtIn: false, light: { ink: '0 0 0' } });
    await expect(service.create(DEV, { name: 'x', from: 'preset:nope' })).rejects.toThrow('Theme not found.');
    await expect(service.activate(DEV, 'preset:crisp')).rejects.toThrow('Theme not found.');
    expect((await service.list(DEV)).presets).toEqual([{ id: 'crisp', name: 'Crisp' }]);
  });
});
