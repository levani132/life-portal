import { PortalService } from './portal.module';
import { resolveFeatureAccess } from '@life-portal/shared-domain';
import type { ModuleId, UserSettings } from '@life-portal/shared-types';

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
