import { Logger, ValidationPipe } from '@nestjs/common';
import { HealthUploadDto } from './health.service';

const sample = {
  id: 'private-id',
  type: 'steps',
  source: 'private-source',
  unit: 'count',
  start: '2026-10-31T10:00:00Z',
  end: '2026-10-31T10:05:00Z',
  value: 123,
};
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const batch = (samples: unknown) =>
  pipe.transform({ samples }, { type: 'body', metatype: HealthUploadDto });

let log: jest.SpyInstance;
beforeEach(() => {
  log = jest.spyOn(Logger, 'log').mockImplementation();
});
afterEach(() => {
  log.mockRestore();
});

it.each(
  [
    [sample],
    JSON.stringify([sample]),
    JSON.stringify(JSON.stringify([sample])),
    sample,
    JSON.stringify(sample),
    [JSON.stringify(sample)],
    JSON.stringify(sample) +
      '\n' +
      JSON.stringify({ ...sample, id: 'second-id' }),
  ].map((input) => ({ input })),
)(
  'normalizes transport formats and retains nested DTO conversion: %#',
  async ({ input }) => {
    const result = await batch(input);
    expect(result.samples[0]).toMatchObject(sample);
    expect(result.samples[0].constructor.name).toBe('SampleDto');
  },
);

it('accepts empty recent snapshots without requiring counts or window metadata', async () => {
  expect((await batch('')).samples).toEqual([]);
  expect((await batch([])).samples).toEqual([]);
});

it.each([
  'not JSON',
  '{}',
  'null',
  '[1]',
  JSON.stringify({ ...sample, value: 'invalid' }),
  JSON.stringify({ ...sample, secret: 'private-secret' }),
  JSON.stringify(sample) + '\nbroken',
  JSON.stringify(Array(3001).fill(sample)),
])(
  'rejects malformed, oversized, or invalid samples instead of dropping them: %#',
  async (input) => {
    await expect(batch(input)).rejects.toThrow();
  },
);

it('logs structure and parsing diagnostics without sample values or arbitrary keys', async () => {
  await batch(JSON.stringify(sample));
  await expect(
    batch(JSON.stringify({ ...sample, 'private-secret-key': 'secret' })),
  ).rejects.toThrow();
  const output = JSON.stringify(log.mock.calls);
  expect(output).toContain('textLength');
  expect(output).toContain('preview');
  expect(output).toContain('unknownFieldCount');
  expect(output).not.toContain('private-');
  expect(output).not.toContain(sample.start);
});
