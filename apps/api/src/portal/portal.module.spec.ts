import { ValidationPipe } from '@nestjs/common';
import { PortalPreferencesDto, PortalService } from './portal.module';
import { privateModuleVisibility, resolveFeatureAccess } from '@life-portal/shared-domain';
import { MODULE_IDS, type ModuleId, type UserSettings } from '@life-portal/shared-types';

/** The same pipe settings as `main.ts`: unknown properties are an error, not ignored. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: PortalPreferencesDto });

describe('portal preferences validation', () => {
  it('accepts every module in the visibility map the web sends back, training included', async () => {
    await expect(validate({ moduleVisibility: privateModuleVisibility() })).resolves.toBeDefined();
  });

  it('accepts selecting every module at once', async () => {
    await expect(validate({ selectedModules: [...MODULE_IDS] })).resolves.toBeDefined();
  });

  it('keeps unshareable modules private', async () => {
    await expect(validate({ moduleVisibility: { training: 'friends' } })).rejects.toBeDefined();
    await expect(validate({ moduleVisibility: { epam: 'friends' } })).rejects.toBeDefined();
  });
});

describe('portal preferences across releases', () => {
  it('freezes the initial selection so newly released modules do not appear automatically', async () => {
    const stored: Partial<UserSettings> = { widgetOrder: [] };
    let access = resolveFeatureAccess('production');
    const settings = {
      get: jest.fn(async () => stored),
      initializeModules: jest.fn(async (_id: string, selectedModules: ModuleId[]) => { stored.selectedModules ??= selectedModules; }),
      setPortalPreferences: jest.fn(async (_id: string, patch: Partial<UserSettings>) => Object.assign(stored, patch)),
    };
    const identity = { forUser: jest.fn(async () => ({ cohort: 'production', access })) };
    const service = new PortalService(settings as never, identity as never, { ensurePrivateSharing: jest.fn() } as never);
    expect((await service.get('person')).selectedModules).toEqual(['nutrition']);
    access = resolveFeatureAccess('production', { money: true });
    expect((await service.get('person')).selectedModules).toEqual(['nutrition']);
    await service.update('person', { selectedModules: ['nutrition', 'money'] });
    access = resolveFeatureAccess('production', { money: false });
    await service.update('person', { selectedModules: ['nutrition'] });
    expect(stored.selectedModules).toEqual(['nutrition', 'money']);
    access = resolveFeatureAccess('production', { money: true });
    expect((await service.get('person')).selectedModules).toEqual(['nutrition', 'money']);
  });
});
