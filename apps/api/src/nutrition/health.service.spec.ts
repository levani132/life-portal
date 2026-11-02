import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'crypto';
import {
  HealthController,
  HealthUploadGuard,
  HealthService,
  HealthUploadDto,
} from './health.service';
import { IS_TOKEN_AUTH } from '../auth/current-user.decorator';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
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
function fixture() {
  const row: Record<string, unknown> = {
    _id: 'connectionA',
    userId: 'accountA',
    paired: true,
    ticketHash: hash('scoped-ticket'),
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const apply = (update: {
    $set?: Record<string, unknown>;
    $unset?: Record<string, unknown>;
  }) => {
    Object.assign(row, update.$set);
    for (const key of Object.keys(update.$unset ?? {})) delete row[key];
  };
  const model = {
    findOne: jest.fn((filter: Record<string, unknown>) => ({
      lean: async () =>
        row.paired &&
        (!filter.ticketHash || filter.ticketHash === row.ticketHash)
          ? { ...row }
          : null,
    })),
    findOneAndUpdate: jest.fn(
      async (
        filter: Record<string, unknown>,
        update: {
          $set?: Record<string, unknown>;
          $unset?: Record<string, unknown>;
        },
      ) => {
        if (
          !row.paired ||
          (filter.ticketHash && filter.ticketHash !== row.ticketHash) ||
          (filter.uploadWriteId && filter.uploadWriteId !== row.uploadWriteId)
        )
          return null;
        const before = { ...row };
        apply(update);
        return before;
      },
    ),
    updateOne: jest.fn(
      async (
        filter: Record<string, unknown>,
        update: {
          $set?: Record<string, unknown>;
          $unset?: Record<string, unknown>;
        },
      ) => {
        if (!filter.uploadWriteId || filter.uploadWriteId === row.uploadWriteId)
          apply(update);
      },
    ),
    exists: jest.fn(async () => !!row.paired),
    deleteOne: jest.fn(),
  };
  const days = {
    updateOne: jest.fn(async (...args: unknown[]) => {
      void args;
    }),
    deleteMany: jest.fn(),
  };
  const access = { require: jest.fn() };
  const shortcutSettings = {
    getUrl: jest.fn(async (): Promise<string | undefined> => undefined),
  };
  const service = new HealthService(
    model as never,
    days as never,
    access as never,
    shortcutSettings as never,
  );
  return { service, model, days, access, row, shortcutSettings };
}

it('uses the database Shortcut URL and ignores the retired environment variable', async () => {
  const previous = process.env['APPLE_HEALTH_SHORTCUT_URL'];
  process.env['APPLE_HEALTH_SHORTCUT_URL'] =
    `https://www.icloud.com/shortcuts/${'a'.repeat(32)}`;
  try {
    const { service, shortcutSettings } = fixture();
    expect((await service.status('accountA')).installationUrl).toBeUndefined();
    const configured = `https://www.icloud.com/shortcuts/${'b'.repeat(32)}`;
    shortcutSettings.getUrl.mockResolvedValue(configured);
    expect((await service.status('accountA')).installationUrl).toBe(configured);
  } finally {
    if (previous === undefined) delete process.env['APPLE_HEALTH_SHORTCUT_URL'];
    else process.env['APPLE_HEALTH_SHORTCUT_URL'] = previous;
  }
});

it('launches a recent-only sync with a token and limit and retires queue metadata without deleting samples', async () => {
  const { service, model, days } = fixture();
  const result = await service.launch('accountA');
  expect(Object.keys(result).sort()).toEqual(['limitPerKind', 'token']);
  expect(result.limitPerKind).toBe(50);
  expect(result.token.length).toBeGreaterThan(30);
  expect(model.findOneAndUpdate.mock.calls[0][1].$unset).toMatchObject({
    batchQueue: 1,
    batchTicketHash: 1,
  });
  expect(days.deleteMany).not.toHaveBeenCalled();
});
it('scopes ownership to a verified ticket, normalizes kJ, deduplicates and consumes the ticket only after storing', async () => {
  const { service, model, days, access, row } = fixture();
  const owner = await service.verify('scoped-ticket');
  expect(owner).toEqual({
    userId: 'accountA',
    connectionId: 'connectionA',
    ticketHash: hash('scoped-ticket'),
  });
  expect(access.require).toHaveBeenCalledWith('accountA', 'nutrition');
  expect(
    await service.upload(owner, { samples: [...samples, ...samples] }),
  ).toMatchObject({ received: 1 });
  expect(days.updateOne).toHaveBeenCalledTimes(1);
  const [filter, pipeline] = days.updateOne.mock.calls[0] as [
    unknown,
    {
      $set: {
        samples: {
          $concatArrays: [
            { $filter: { cond: unknown } },
            { $literal: { value: number }[] },
          ];
        };
      };
    }[],
  ];
  expect(filter).toMatchObject({
    userId: 'accountA',
    connectionId: 'connectionA',
    day: '2026-10-31',
  });
  expect(
    pipeline[0].$set.samples.$concatArrays[1].$literal[0].value,
  ).toBeCloseTo(200);
  expect(pipeline[0].$set.samples.$concatArrays[0].$filter.cond).toEqual({
    $not: [
      {
        $in: [
          { $concat: ['$$s.type', ':', '$$s.source', ':', '$$s.id'] },
          ['activeEnergy:watch:1'],
        ],
      },
    ],
  });
  expect(row.ticketHash).toBeUndefined();
  expect(row.lastReceivedCount).toBe(1);
  expect(model.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
    userId: 'accountA',
    _id: 'connectionA',
    ticketHash: hash('scoped-ticket'),
  });
  await expect(service.upload(owner, { samples })).rejects.toThrow(
    'already used',
  );
});
it('accepts older recent samples without a date window and groups offset dates into their UTC storage day', async () => {
  const { service, days } = fixture();
  const owner = await service.verify('scoped-ticket');
  await service.upload(owner, {
    samples: [
      {
        ...samples[0],
        start: '2020-01-02T00:30:00+04:00',
        end: '2020-01-02T00:35:00+04:00',
      },
    ],
  });
  expect(days.updateOne.mock.calls[0][0]).toMatchObject({ day: '2020-01-01' });
});
it('never writes empty snapshots to daily history or advances the last data receipt', async () => {
  const { service, days, row } = fixture();
  row.lastSync = '2026-10-31T00:00:00Z';
  const owner = await service.verify('scoped-ticket');
  expect(await service.upload(owner, { samples: [] })).toMatchObject({
    received: 0,
  });
  expect(days.updateOne).not.toHaveBeenCalled();
  expect(days.deleteMany).not.toHaveBeenCalled();
  expect(row.lastSync).toBe('2026-10-31T00:00:00Z');
  expect(row.lastReceivedCount).toBe(0);
  expect(row.lastUploadAt).toBeDefined();
});
it('retains a failed upload ticket for a safe retry', async () => {
  const { service, days, row } = fixture();
  const owner = await service.verify('scoped-ticket');
  days.updateOne.mockRejectedValueOnce(new Error('write failed'));
  await expect(service.upload(owner, { samples })).rejects.toThrow(
    'write failed',
  );
  expect(row.ticketHash).toBe(hash('scoped-ticket'));
  expect(row.uploadingUntil).toBeUndefined();
  expect(row.lastUploadAt).toBeUndefined();
  expect(await service.upload(owner, { samples })).toMatchObject({
    received: 1,
  });
});
it('cleans up an upload revoked during storage without restoring the connection', async () => {
  const { service, days, row } = fixture();
  const owner = await service.verify('scoped-ticket');
  days.updateOne.mockImplementationOnce(async () => {
    row.paired = false;
  });
  await expect(service.upload(owner, { samples })).rejects.toThrow(
    'connection changed',
  );
  expect(days.deleteMany).toHaveBeenCalledWith({
    userId: 'accountA',
    connectionId: 'connectionA',
  });
  expect(row.lastSync).toBeUndefined();
});
it('accepts exactly 50 per type in one upload without splitting', async () => {
  const { service } = fixture();
  const owner = await service.verify('scoped-ticket');
  const rows = Array.from({ length: 50 }, (_, i) => ({
    ...samples[0],
    id: `energy-${i}`,
  }));
  const steps = rows.map((s, i) => ({
    ...s,
    id: `steps-${i}`,
    type: 'steps' as const,
    unit: 'count',
  }));
  expect(
    await service.upload(owner, { samples: [...rows, ...steps] }),
  ).toMatchObject({ received: 100 });
});
it('rejects more than 50 per kind, future dates, absent timezones and unsupported units before writing', async () => {
  const { service, days } = fixture();
  const owner = await service.verify('scoped-ticket');
  await expect(
    service.upload(owner, { samples: Array(51).fill(samples[0]) }),
  ).rejects.toThrow('at most 50');
  for (const row of [
    { ...samples[0], unit: 'watts' },
    { ...samples[0], end: '2100-01-01T00:00:00Z' },
    { ...samples[0], start: '2026-10-31T07:00:00' },
  ])
    await expect(service.upload(owner, { samples: [row] })).rejects.toThrow();
  expect(days.updateOne).not.toHaveBeenCalled();
});
it('rejects expired or revoked credentials', async () => {
  const { service, model } = fixture();
  model.findOne.mockReturnValue({ lean: async () => null });
  await expect(service.verify('revoked')).rejects.toThrow(
    'Expired, used or revoked',
  );
});
it('lets uploads use the scoped Health guard without an account JWT', () => {
  expect(
    Reflect.getMetadata(IS_TOKEN_AUTH, HealthController.prototype.upload),
  ).toBe(true);
  expect(
    Reflect.getMetadata(GUARDS_METADATA, HealthController.prototype.upload),
  ).toContain(HealthUploadGuard);
});
it('validates JSON-text samples with the same nested rules as native arrays', async () => {
  const input = { ...samples[0], value: '836.8' };
  const options = { whitelist: true, forbidNonWhitelisted: true };
  for (const payload of [[input], JSON.stringify([input])]) {
    const dto = plainToInstance(HealthUploadDto, { samples: payload });
    expect(await validate(dto, options)).toEqual([]);
    expect(dto.samples[0].value).toBe(836.8);
  }
  for (const payload of [
    'not JSON',
    '{}',
    'null',
    JSON.stringify(Array(101).fill(samples[0])),
    JSON.stringify([
      {
        ...input,
        start: 'invalid',
        value: 'not-a-number',
        userId: 'another-account',
      },
    ]),
  ]) {
    expect(
      (
        await validate(
          plainToInstance(HealthUploadDto, { samples: payload }),
          options,
        )
      ).length,
    ).toBeGreaterThan(0);
  }
});
