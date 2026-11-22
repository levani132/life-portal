import { ConflictException, Controller, ForbiddenException, Get, type INestApplication, Param } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ERROR_KINDS_PER_DAY, ErrorsController, ErrorsService, RecordingExceptionFilter } from './errors.module';

@Controller('boom')
class BoomController {
  @Get('crash/:id') crash(@Param('id') id: string) {
    throw new TypeError(`Cannot read user ${id} with mail ana@example.com`);
  }
  @Get('refused') refused() {
    throw new ConflictException({ code: 'STALE_EDIT', message: 'Reload first.' });
  }
}

describe('the recording filter, over real HTTP', () => {
  let app: INestApplication;
  let base: string;
  const record = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BoomController],
      providers: [
        { provide: ErrorsService, useValue: { record } },
        { provide: APP_FILTER, useClass: RecordingExceptionFilter },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(() => app.close());
  beforeEach(() => record.mockClear());

  it('records a crash by its route pattern and still answers a plain 500', async () => {
    const response = await fetch(`${base}/boom/crash/64f0c1e2a3b4c5d6e7f80912`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ source: 'api', name: 'TypeError', where: 'GET /boom/crash/:id', status: 500 });
  });

  it('does not record a refusal, and answers it unchanged', async () => {
    const response = await fetch(`${base}/boom/refused`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'STALE_EDIT', message: 'Reload first.' });
    expect(record).not.toHaveBeenCalled();
  });

  it('does not record a missing page', async () => {
    expect((await fetch(`${base}/nowhere`)).status).toBe(404);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('the error log', () => {
  function fixture() {
    const updateOne = jest.fn().mockReturnValue({ catch: jest.fn() });
    const rows: unknown[] = [];
    const events = { updateOne, find: () => ({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve(rows) }) }) }) };
    const access = {
      requireDeveloper: (userId: string) => {
        if (userId !== 'dev') throw new ForbiddenException();
      },
    };
    return { updateOne, rows, service: new ErrorsService(events as never, access as never) };
  }
  const NOW = new Date('2026-11-22T10:00:00Z');

  it('stores a scrubbed message and place, and nothing about who', () => {
    const f = fixture();
    f.service.record({ source: 'api', name: 'TypeError', message: 'no user 64f0c1e2a3b4c5d6e7f80912 for ana@example.com', where: 'GET /posts/:id', status: 500, stack: 'TypeError: x\n at a (file.js?token=abc:1:1)' }, NOW);
    const [filter, update] = f.updateOne.mock.calls[0];
    expect(filter.day).toBe('2026-11-22');
    expect(update.$setOnInsert).toMatchObject({ source: 'api', name: 'TypeError', message: 'no user <id> for <email>', where: 'GET /posts/:id', status: 500 });
    expect(JSON.stringify(update)).not.toMatch(/ana@|64f0c1e2|token=abc|userId/);
    expect(update.$inc).toEqual({ count: 1 });
  });

  it('counts the same error once per kind: same fingerprint both times', () => {
    const f = fixture();
    const input = { source: 'web' as const, name: 'Error', message: 'boom', where: '/nutrition' };
    f.service.record(input, NOW);
    f.service.record(input, NOW);
    expect(f.updateOne.mock.calls[0][0].fingerprint).toBe(f.updateOne.mock.calls[1][0].fingerprint);
  });

  it('stops writing new kinds after the daily cap, and keeps counting known ones', () => {
    const f = fixture();
    for (let i = 0; i < ERROR_KINDS_PER_DAY + 20; i++) f.service.record({ source: 'api', name: 'Error', message: `kind ${i % 7 === 0 ? 'a' : ''}${i}x`, where: `GET /r${i}` }, NOW);
    expect(f.updateOne).toHaveBeenCalledTimes(ERROR_KINDS_PER_DAY);
    f.service.record({ source: 'api', name: 'Error', message: 'kind a0x', where: 'GET /r0' }, NOW);
    expect(f.updateOne).toHaveBeenCalledTimes(ERROR_KINDS_PER_DAY + 1);
  });

  it('never throws, whatever it is given', () => {
    const f = fixture();
    f.updateOne.mockImplementation(() => {
      throw new Error('db down');
    });
    expect(() => f.service.record({ source: 'api', name: 'E', message: 'm', where: 'w' }, NOW)).not.toThrow();
  });

  it('reports to the developer only, grouped across days, most frequent first', async () => {
    const f = fixture();
    await expect(f.service.report('ana', 7, NOW)).rejects.toThrow(ForbiddenException);
    const row = (day: string, fingerprint: string, count: number) => ({ day, fingerprint, source: 'api', name: 'E', message: fingerprint, where: 'GET /x', count, lastAt: new Date(`${day}T09:00:00Z`) });
    f.rows.push(row('2026-11-20', 'aaa', 2), row('2026-11-21', 'bbb', 9), row('2026-11-22', 'aaa', 3));
    const report = await f.service.report('dev', 7, NOW);
    expect(report.total).toBe(14);
    expect(report.groups.map((group) => [group.fingerprint, group.count, group.firstDay, group.lastDay])).toEqual([
      ['bbb', 9, '2026-11-21', '2026-11-21'],
      ['aaa', 5, '2026-11-20', '2026-11-22'],
    ]);
  });

  it('takes ten page errors a minute from one account and drops the rest', () => {
    const record = jest.fn();
    const controller = new ErrorsController({ record } as never);
    for (let i = 0; i < 25; i++) controller.client('ana', { name: 'Error', message: 'boom', page: '/posts/64f0c1e2a3b4c5d6e7f80912?k=secret' });
    expect(record).toHaveBeenCalledTimes(10);
    expect(record.mock.calls[0][0]).toMatchObject({ source: 'web', where: '/posts/:id' });
  });
});
