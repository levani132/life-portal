import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import mongoose from 'mongoose';

/**
 * The whole app's dependency wiring, without a database. `npm run check` once passed while the
 * API could not boot (a provider one module could not see); this is that failure, caught here.
 * The connection is replaced by one that never connects, and nothing is initialised, so no
 * query runs: it only proves every provider can be built.
 */
describe('the app module', () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env = saved;
  });

  it('resolves every provider', async () => {
    process.env['MONGODB_URI'] = 'mongodb://127.0.0.1:1/none';
    process.env['JWT_SECRET'] = 'x'.repeat(40);
    process.env['DISABLE_SCHEDULES'] = 'true';
    const { AppModule } = await import('./app.module');
    const connection = mongoose.createConnection();
    try {
      const app = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(getConnectionToken())
        .useValue(connection)
        .compile();
      expect(app).toBeDefined();
    } finally {
      await connection.close().catch(() => undefined);
    }
  }, 60_000);
});
