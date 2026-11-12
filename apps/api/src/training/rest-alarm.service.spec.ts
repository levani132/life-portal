import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { RestAlarmService } from './rest-alarm.service';

const T0 = Date.parse('2026-11-12T18:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();

function fixture() {
  const open = new Set<string>();
  const sessions = {
    exists: jest.fn(async (filter: { _id: string; userId: string; status: string }) =>
      open.has(`${filter.userId}:${filter._id}`) && filter.status === 'open' ? { _id: filter._id } : null,
    ),
  };
  const notifications = { register: jest.fn(), remind: jest.fn(async () => undefined) };
  const service = new RestAlarmService(sessions as never, notifications as never);
  const sessionId = new Types.ObjectId().toHexString();
  open.add(`me:${sessionId}`);
  return { service, notifications, sessionId };
}

describe('RestAlarmService (spec 025)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
  });
  afterEach(() => jest.useRealTimers());

  it('registers restOver as a personal reminder needing training', () => {
    const f = fixture();
    f.service.onModuleInit();
    expect(f.notifications.register).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'restOver', requires: ['training'], personal: true, windowMs: 0 }),
    );
  });

  it('reminds once when the rest ends', async () => {
    const f = fixture();
    await f.service.set('me', f.sessionId, at(90_000), T0);
    jest.advanceTimersByTime(89_000);
    expect(f.notifications.remind).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(f.notifications.remind).toHaveBeenCalledWith({ type: 'restOver', recipientId: 'me', targetId: f.sessionId });
    expect(f.service.pending('me')).toBeUndefined();
  });

  it('moving the alarm replaces it (+15 s), and null cancels it (Skip)', async () => {
    const f = fixture();
    await f.service.set('me', f.sessionId, at(90_000), T0);
    await f.service.set('me', f.sessionId, at(105_000), T0);
    jest.advanceTimersByTime(100_000);
    expect(f.notifications.remind).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5_000);
    expect(f.notifications.remind).toHaveBeenCalledTimes(1);
    await f.service.set('me', f.sessionId, at(200_000), T0 + 105_000);
    await f.service.set('me', f.sessionId, null, T0 + 106_000);
    jest.advanceTimersByTime(200_000);
    expect(f.notifications.remind).toHaveBeenCalledTimes(1);
  });

  it('clear() cancels it, as finishing or discarding the workout does', async () => {
    const f = fixture();
    await f.service.set('me', f.sessionId, at(60_000), T0);
    f.service.clear('me');
    jest.advanceTimersByTime(120_000);
    expect(f.notifications.remind).not.toHaveBeenCalled();
  });

  it('a time already past sets nothing', async () => {
    const f = fixture();
    await f.service.set('me', f.sessionId, at(-1_000), T0);
    expect(f.service.pending('me')).toBeUndefined();
  });

  it('refuses an alarm more than 20 minutes ahead', async () => {
    const f = fixture();
    await expect(f.service.set('me', f.sessionId, at(21 * 60_000), T0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("answers 404 for someone else's session or one not open", async () => {
    const f = fixture();
    await expect(f.service.set('other', f.sessionId, at(60_000), T0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.set('me', new Types.ObjectId().toHexString(), at(60_000), T0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.set('me', 'not-an-id', at(60_000), T0)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps one alarm per person, independently', async () => {
    const f = fixture();
    const theirs = new Types.ObjectId().toHexString();
    (f.service as unknown as { sessions: { exists: jest.Mock } }).sessions.exists.mockResolvedValue({ _id: theirs });
    await f.service.set('me', f.sessionId, at(60_000), T0);
    await f.service.set('you', theirs, at(30_000), T0);
    jest.advanceTimersByTime(60_000);
    expect(f.notifications.remind).toHaveBeenCalledTimes(2);
  });
});
