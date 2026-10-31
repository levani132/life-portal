import { HealthController, HealthUploadGuard } from './health.service';
import { IS_TOKEN_AUTH } from '../auth/current-user.decorator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HealthService, HealthUploadDto } from './health.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'crypto';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture() {
  const row: Record<string, unknown> = {
    _id: 'connectionA',
    userId: 'accountA',
    paired: true,
    from: '2026-10-29T00:00:00Z',
    to: '2026-10-31T12:00:00Z',
    ticketHash: hash('scoped-ticket'),
  };
  const model = {
    findOne: jest.fn(() => ({ lean: async () => ({ ...row }) })),
    findOneAndUpdate: jest.fn(async (filter: Record<string, unknown>) =>
      filter.ticketHash === row.ticketHash
        ? (delete row.ticketHash, { ...row })
        : null,
    ),
    updateOne: jest.fn(),
    exists: jest.fn(async () => true),
    deleteOne: jest.fn(),
  };
  const days = { updateOne: jest.fn(), deleteMany: jest.fn() };
  const access = { require: jest.fn() };
  const service = new HealthService(
    model as never,
    days as never,
    access as never,
  );
  return { service, model, days, access };
}
const samples = [
  {
    id: '1',
    source: 'watch',
    type: 'activeEnergy' as const,
    start: '2026-10-31T07:00:00Z',
    end: '2026-10-31T08:00:00Z',
    value: 836.8,
    unit: 'kJ',
  },
];
it('scopes upload ownership to the verified ticket, normalizes units and consumes it once', async () => {
  const { service, model, days, access } = fixture();
  const owner = await service.verify('scoped-ticket');
  expect(owner.userId).toBe('accountA');
  expect(access.require).toHaveBeenCalledWith('accountA', 'nutrition');
  await service.upload(owner, { samples: [...samples, ...samples] });
  expect(model.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
    _id: 'connectionA',
    userId: 'accountA',
    ticketHash: hash('scoped-ticket'),
  });
  const calls = days.updateOne.mock.calls as unknown as [
    Record<string, unknown>,
    unknown,
  ][];
  expect(
    calls.every(
      ([filter]) =>
        filter.userId === 'accountA' && filter.connectionId === 'connectionA',
    ),
  ).toBe(true);
  const pipeline = calls[2][1] as {
    $set: {
      samples: { $concatArrays: [unknown, { $literal: { value: number }[] }] };
    };
  }[];
  expect(pipeline[0].$set.samples.$concatArrays[1].$literal).toHaveLength(1);
  expect(
    pipeline[0].$set.samples.$concatArrays[1].$literal[0].value,
  ).toBeCloseTo(200);
  await expect(service.upload(owner, { samples })).rejects.toThrow(
    'already used or revoked',
  );
});
it('rejects uncertain units, unbounded timestamps and oversized payloads', async () => {
  const { service } = fixture();
  const owner = await service.verify('scoped-ticket');
  await expect(
    service.upload(owner, { samples: [{ ...samples[0], unit: 'watts' }] }),
  ).rejects.toThrow('kcal or kJ');
  await expect(
    service.upload(owner, {
      samples: [{ ...samples[0], start: '2026-10-01T00:00:00Z' }],
    }),
  ).rejects.toThrow('bounded');
  expect(
    (
      await validate(
        plainToInstance(HealthUploadDto, {
          samples: Array(3001).fill(samples[0]),
        }),
      )
    ).length,
  ).toBeGreaterThan(0);
});
it('rejects expired or revoked credentials', async () => {
  const { service, model } = fixture();
  model.findOne.mockReturnValue({ lean: async () => null } as never);
  await expect(service.verify('revoked')).rejects.toThrow(
    'Expired, used or revoked',
  );
});

it('lets Shortcut uploads reach the scoped Health guard without an account JWT', () => {
  expect(
    Reflect.getMetadata(IS_TOKEN_AUTH, HealthController.prototype.upload),
  ).toBe(true);
  expect(
    Reflect.getMetadata(GUARDS_METADATA, HealthController.prototype.upload),
  ).toContain(HealthUploadGuard);
});

it('accepts a Shortcut JSON-text array with the same nested validation as native arrays', async () => {
  const input = { ...samples[0], value: '836.8' };
  const options = { whitelist: true, forbidNonWhitelisted: true };
  for (const payload of [[input], JSON.stringify([input])]) {
    const dto = plainToInstance(HealthUploadDto, { samples: payload });
    expect(await validate(dto, options)).toEqual([]);
    expect(dto.samples[0].value).toBe(836.8);
  }
  const bad = plainToInstance(HealthUploadDto, {
    samples: JSON.stringify([
      {
        ...input,
        start: 'invalid',
        value: 'not-a-number',
        userId: 'another-account',
      },
    ]),
  });
  const errors = await validate(bad, options);
  expect(
    errors[0].children?.[0].children?.map((error) => error.property),
  ).toEqual(expect.arrayContaining(['start', 'value', 'userId']));
});
it('rejects malformed text, invalid objects and oversized Shortcut arrays', async () => {
  for (const samples of [
    'not JSON',
    '{}',
    'null',
    JSON.stringify(Array(3001).fill({})),
  ]) {
    const dto = plainToInstance(HealthUploadDto, { samples });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  }
});
