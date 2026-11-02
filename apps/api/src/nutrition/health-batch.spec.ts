import { HealthService } from './health.service';
import { Logger } from '@nestjs/common';
import {
  HEALTH_BATCH_LIMIT,
  HEALTH_WINDOW_HOURS,
  healthWindowResponse,
  planHealthWindows,
  splitHealthWindow,
} from './health-batch';
const end = '2026-10-31T15:30:00.000Z';
const w = {
  id: 'a'.repeat(32),
  from: '2026-10-31T14:00:00.000Z',
  to: '2026-10-31T15:00:00.000Z',
};
it('partitions first-sync time without gaps, newest first, and resumes unfinished windows', () => {
  const queue = planHealthWindows(end);
  expect(queue[0].to).toBe(end);
  expect(queue).toHaveLength(12);
  expect(
    queue.every(
      (window) =>
        Date.parse(window.to) - Date.parse(window.from) ===
        HEALTH_WINDOW_HOURS * 3600000,
    ),
  ).toBe(true);
  expect(queue.at(-1)?.from).toBe('2026-10-28T15:30:00.000Z');
  for (let i = 1; i < queue.length; i++)
    expect(queue[i].to).toBe(queue[i - 1].from);
  const resumed = planHealthWindows('2026-10-31T16:00:00.000Z', end, [w]);
  expect(resumed[0]).toEqual(w);
  expect(resumed.at(-1)?.from).toBe(end);
  expect(planHealthWindows(end, end, []).at(-1)?.from).toBe(
    '2026-10-31T09:30:00.000Z',
  );
});
it('covers time since a completed plan instead of skipping gaps longer than six hours', () => {
  const previous = '2026-10-30T15:30:00.000Z';
  const queue = planHealthWindows(end, previous, []);
  expect(queue).toHaveLength(4);
  expect(queue[0].to).toBe(end);
  expect(queue.at(-1)?.from).toBe(previous);
  for (let i = 1; i < queue.length; i++)
    expect(queue[i].to).toBe(queue[i - 1].from);
  const old = planHealthWindows(end, '2026-10-01T00:00:00.000Z', []);
  expect(old).toHaveLength(12);
  expect(old.at(-1)?.from).toBe('2026-10-28T15:30:00.000Z');
});

it('advertises a 50-per-kind limit for at most 100 combined Shortcut items', () => {
  expect(HEALTH_BATCH_LIMIT).toBe(50);
  expect(healthWindowResponse([w]).window?.limitPerKind).toBe(50);
});

it('splits capped intervals and blocks an irreducibly dense second without claiming completion', () => {
  const split = splitHealthWindow(w);
  expect(split[0].from).toBe(split[1].to);
  expect(split[0].to).toBe(w.to);
  expect(split[1].from).toBe(w.from);
  expect(
    healthWindowResponse(
      splitHealthWindow({ ...w, to: '2026-10-31T14:00:01.000Z' }),
    ),
  ).toMatchObject({ state: 'blocked', done: false });
});
function fixture() {
  const owner = {
    userId: 'accountA',
    connectionId: 'connectionA',
    ticketHash: 'hash',
    from: w.from,
    to: end,
  };
  const current = {
    _id: 'connectionA',
    userId: 'accountA',
    batchPlannedTo: end,
    batchQueue: [w],
    batchAcknowledgedIds: [] as string[],
  };
  const model = {
    findOne: jest.fn(() => ({ lean: async () => current })),
    findOneAndUpdate: jest.fn(async (filter: unknown, update: unknown) => {
      void filter;
      void update;
      return {};
    }),
    updateOne: jest.fn(),
    exists: jest.fn(async () => true),
  };
  const days = { updateOne: jest.fn(), deleteMany: jest.fn() };
  return {
    owner,
    current,
    model,
    days,
    service: new HealthService(
      model as never,
      days as never,
      { require: jest.fn() } as never,
    ),
  };
}
it('acknowledges only successfully stored windows and treats lost-response retries idempotently', async () => {
  const { owner, current, model, days, service } = fixture();
  const dto = {
    windowId: w.id,
    activeCount: 1,
    stepCount: 0,
    samples: [
      {
        id: 's',
        source: 'watch',
        type: 'activeEnergy' as const,
        start: w.from,
        end: w.to,
        value: 100,
        unit: 'kcal',
      },
    ],
  };
  expect(await service.batchUpload(owner, dto)).toMatchObject({
    acknowledged: w.id,
    done: true,
  });
  expect(days.updateOne).toHaveBeenCalledTimes(1);
  expect(model.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
    userId: owner.userId,
    _id: owner.connectionId,
    batchTicketHash: owner.ticketHash,
    'batchQueue.0.id': w.id,
  });
  current.batchAcknowledgedIds.push(w.id);
  await service.batchUpload(owner, dto);
  expect(days.updateOne).toHaveBeenCalledTimes(1);
});
it('splits metadata-only capped queries without claiming any stored data', async () => {
  const { owner, model, days, service } = fixture();
  expect(
    await service.batchUpload(owner, {
      windowId: w.id,
      activeCount: HEALTH_BATCH_LIMIT,
      stepCount: 0,
      samples: [],
    }),
  ).toMatchObject({ split: true, done: false, remaining: 2 });
  expect(days.updateOne).not.toHaveBeenCalled();
  const update = model.findOneAndUpdate.mock.calls[1][1] as {
    $set: Record<string, unknown>;
  };
  expect(update.$set).not.toHaveProperty('lastSync');
});
const cappedSamples = () =>
  Array.from({ length: HEALTH_BATCH_LIMIT }, (_, i) => ({
    id: `capped-${i}`,
    source: 'watch',
    type: 'activeEnergy' as const,
    start: w.from,
    end: w.to,
    value: 1,
    unit: 'kcal',
  }));
it('stores validated capped samples before queuing smaller windows without claiming coverage is complete', async () => {
  const { owner, model, days, service } = fixture();
  const result = await service.batchUpload(owner, {
    windowId: w.id,
    activeCount: HEALTH_BATCH_LIMIT,
    stepCount: 0,
    samples: cappedSamples(),
  });
  expect(result).toMatchObject({
    split: true,
    stored: HEALTH_BATCH_LIMIT,
    done: false,
    remaining: 2,
  });
  expect(days.updateOne).toHaveBeenCalledTimes(1);
  const pipeline = (
    days.updateOne.mock.calls[0] as unknown as [
      unknown,
      {
        $set: {
          samples: { $concatArrays: [unknown, { $literal: unknown[] }] };
        };
      }[],
    ]
  )[1];
  expect(pipeline[0].$set.samples.$concatArrays[1].$literal).toHaveLength(
    HEALTH_BATCH_LIMIT,
  );
  const update = model.findOneAndUpdate.mock.calls[1][1] as {
    $set: Record<string, unknown>;
  };
  expect(update.$set).not.toHaveProperty('lastSync');
});
it('rejects out-of-window or mismatched capped payloads before saving or advancing', async () => {
  const { owner, model, days, service } = fixture();
  const samples = cappedSamples();
  samples[0].start = '2026-10-01T00:00:00.000Z';
  await expect(
    service.batchUpload(owner, {
      windowId: w.id,
      activeCount: HEALTH_BATCH_LIMIT,
      stepCount: 0,
      samples,
    }),
  ).rejects.toThrow('absolute time window');
  await expect(
    service.batchUpload(owner, {
      windowId: w.id,
      activeCount: HEALTH_BATCH_LIMIT,
      stepCount: 0,
      samples: cappedSamples().slice(1),
    }),
  ).rejects.toThrow('counts must match');
  expect(days.updateOne).not.toHaveBeenCalled();
  expect(model.findOneAndUpdate).not.toHaveBeenCalled();
});
it('reports the failed timing rule without exposing record IDs or health values', async () => {
  const { owner, service } = fixture();
  const samples = cappedSamples();
  samples[0] = {
    ...samples[0],
    id: 'private-id',
    source: 'private-source',
    start: '2026-10-31T13:00:00.000Z',
    value: 12345,
  };
  const log = jest.spyOn(Logger, 'warn').mockImplementation();
  try {
    await expect(
      service.batchUpload(owner, {
        windowId: w.id,
        activeCount: HEALTH_BATCH_LIMIT,
        stepCount: 0,
        samples,
      }),
    ).rejects.toThrow('Sample 1: start_before_window');
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain('startOffsetSeconds');
    expect(output).toContain('-3600');
    expect(output).not.toContain('private-');
    expect(output).not.toContain('12345');
  } finally {
    log.mockRestore();
  }
});

it('keeps capped windows pending when storage fails', async () => {
  const { owner, model, days, service } = fixture();
  days.updateOne.mockRejectedValueOnce(new Error('write failed'));
  await expect(
    service.batchUpload(owner, {
      windowId: w.id,
      activeCount: HEALTH_BATCH_LIMIT,
      stepCount: 0,
      samples: cappedSamples(),
    }),
  ).rejects.toThrow('write failed');
  expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
});

it('leaves the cursor pending on database failure and rejects another window', async () => {
  const { owner, days, model, service } = fixture();
  await expect(
    service.batchUpload(owner, {
      windowId: 'b'.repeat(32),
      activeCount: 0,
      stepCount: 0,
      samples: [],
    }),
  ).rejects.toThrow('pending Health window');
  days.updateOne.mockRejectedValueOnce(new Error('write failed'));
  await expect(
    service.batchUpload(owner, {
      windowId: w.id,
      activeCount: 0,
      stepCount: 0,
      samples: [],
    }),
  ).rejects.toThrow('write failed');
  expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1); // Lease only; no acknowledgement.
});

it('binds batch sessions to the verified owner and rejects revoked sessions', async () => {
  const { service, model } = fixture();
  expect(await service.verifyBatch('session-ticket')).toMatchObject({
    userId: 'accountA',
    connectionId: 'connectionA',
  });
  expect(model.findOne).toHaveBeenCalledWith(
    expect.objectContaining({
      paired: true,
      batchExpiresAt: expect.any(Object),
    }),
  );
  model.findOne.mockReturnValueOnce({ lean: async () => null } as never);
  await expect(service.verifyBatch('revoked')).rejects.toThrow(
    'Expired or revoked',
  );
});

it('validates inherited JSON-text samples and batch counts before accepting a batch', async () => {
  const { plainToInstance } = await import('class-transformer');
  const { validate } = await import('class-validator');
  const { HealthBatchUploadDto } = await import('./health.service');
  const dto = plainToInstance(HealthBatchUploadDto, {
    windowId: w.id,
    activeCount: '1',
    stepCount: '0',
    samples: JSON.stringify([
      {
        id: 's',
        source: 'watch',
        type: 'activeEnergy',
        start: w.from,
        end: w.to,
        value: 100,
        unit: 'kcal',
      },
    ]),
  });
  expect(
    await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
  ).toEqual([]);
  expect(dto.activeCount).toBe(1);
  expect(dto.samples[0].value).toBe(100);
});
