import { ForbiddenException } from '@nestjs/common';
import { TrainingLevelService } from './level.service';

function fixture(rows: object[], counts: { _id: string; count: number }[]) {
  const query = { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(rows) };
  const sessions = { find: jest.fn().mockReturnValue(query) };
  const sets = { aggregate: jest.fn().mockResolvedValue(counts) };
  const access = { require: jest.fn().mockResolvedValue(undefined) };
  const service = new TrainingLevelService(sessions as never, sets as never, access as never);
  return { service, sessions, sets, access };
}
const row = (id: string, day: string, minutes: number) => ({
  _id: id,
  day,
  status: 'finished',
  startedAt: new Date(`${day}T18:00:00Z`),
  endedAt: new Date(Date.parse(`${day}T18:00:00Z`) + minutes * 60_000),
});

describe('TrainingLevelService (issue #5a)', () => {
  it('needs the trainingLevels flag', async () => {
    const f = fixture([], []);
    f.access.require.mockRejectedValue(new ForbiddenException());
    await expect(f.service.level('me', '2026-11-13')).rejects.toThrow(ForbiddenException);
    expect(f.sessions.find).not.toHaveBeenCalled();
  });

  it('reads only the caller’s finished sessions up to today and counts non-warm-up sets', async () => {
    const f = fixture(
      [row('a', '2026-11-09', 45), row('b', '2026-11-11', 5), row('c', '2026-11-12', 40)],
      [
        { _id: 'a', count: 8 },
        { _id: 'b', count: 9 }, // too short to count
        { _id: 'c', count: 2 }, // too few sets to count
      ],
    );
    const level = await f.service.level('me', '2026-11-13');
    expect(f.access.require).toHaveBeenCalledWith('me', 'trainingLevels');
    expect(f.sessions.find).toHaveBeenCalledWith({ userId: 'me', status: 'finished', day: { $lte: '2026-11-13' } });
    expect(f.sets.aggregate.mock.calls[0][0][0]).toEqual({ $match: { userId: 'me', type: { $ne: 'warmup' } } });
    expect(level).toMatchObject({ xp: 110, countedWorkouts: 1 });
  });

  it('skips the set count when there are no sessions', async () => {
    const f = fixture([], []);
    expect(await f.service.level('me', '2026-11-13')).toMatchObject({ level: 1, xp: 0 });
    expect(f.sets.aggregate).not.toHaveBeenCalled();
  });
});
