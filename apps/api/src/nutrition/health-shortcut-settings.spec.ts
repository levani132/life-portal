import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccessService } from '../access/access.module';
import {
  HealthShortcutSettingsService,
  UpdateHealthShortcutDto,
} from './health-shortcut-settings';
const url = `https://www.icloud.com/shortcuts/${'a'.repeat(32)}`;
function fixture() {
  const model = {
    findById: jest.fn(() => ({ lean: async () => ({ installationUrl: url }) })),
    updateOne: jest.fn(),
  };
  const access = new AccessService(
    {} as never,
    { developerUserId: 'owner' } as never,
    {} as never,
  );
  return {
    model,
    access,
    service: new HealthShortcutSettingsService(model as never, access as never),
  };
}
it('rejects non-admin reads and writes before accessing global settings', async () => {
  const { model, service } = fixture();
  await expect(service.get('other')).rejects.toThrow(ForbiddenException);
  await expect(service.update('other', url)).rejects.toThrow(
    ForbiddenException,
  );
  expect(model.findById).not.toHaveBeenCalled();
  expect(model.updateOne).not.toHaveBeenCalled();
});
it('stores the owner’s new URL once for all users and never reads the old environment setting', async () => {
  const { model, service } = fixture();
  expect(await service.get('owner')).toEqual({ installationUrl: url });
  const next = `https://www.icloud.com/shortcuts/${'b'.repeat(32)}`;
  expect(await service.update('owner', ` ${next} `)).toEqual({
    installationUrl: next,
  });
  expect(model.updateOne).toHaveBeenCalledWith(
    { _id: 'apple-health' },
    {
      $set: { installationUrl: next, updatedBy: 'owner' },
    },
    { upsert: true },
  );
});
it.each([
  'javascript:alert(1)',
  'https://evil.example/shortcuts/' + 'a'.repeat(32),
  url + '?redirect=other',
  'https://www.icloud.com/shortcuts/nope',
])('rejects invalid sharing URLs: %s', async (input) => {
  const { service, model } = fixture();
  await expect(service.update('owner', input)).rejects.toThrow();
  expect(model.updateOne).not.toHaveBeenCalled();
  expect(
    (
      await validate(
        plainToInstance(UpdateHealthShortcutDto, { installationUrl: input }),
      )
    ).length,
  ).toBeGreaterThan(0);
});
it('accepts and trims valid owner input', async () => {
  const dto = plainToInstance(UpdateHealthShortcutDto, {
    installationUrl: ` ${url} `,
  });
  expect(await validate(dto)).toEqual([]);
  expect(dto.installationUrl).toBe(url);
});
