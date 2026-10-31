import { Logger, BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HealthUploadDto } from './health.service';
import { healthValidationException } from './health-validation';

it('reports rejected Health fields without logging values, tokens or arbitrary keys', async () => {
  const log = jest.spyOn(Logger, 'warn').mockImplementation();
  try {
    const dto = plainToInstance(HealthUploadDto, {
      samples: [
        {
          id: 'private-id',
          type: 'activeEnergy',
          source: 'private-source',
          unit: 'kcal',
          start: 'private-date',
          end: 'private-date',
          value: 'private-value',
          'private-secret-key': 'secret',
        },
      ],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const exception = healthValidationException(errors);
    if (!(exception instanceof BadRequestException))
      throw new Error('Expected validation exception');
    expect(exception.getStatus()).toBe(400);
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain('samples.0.start');
    expect(output).toContain('isIso8601');
    expect(output).toContain('<unknown-field>');
    expect(output).not.toContain('private-');
  } finally {
    log.mockRestore();
  }
});
it('keeps normal validation responses for non-Health requests without Health logging', () => {
  const log = jest.spyOn(Logger, 'warn').mockImplementation();
  try {
    const exception = healthValidationException([
      { property: 'name', constraints: { isString: 'name must be a string' } },
    ]);
    if (!(exception instanceof BadRequestException))
      throw new Error('Expected validation exception');
    expect(exception.getResponse()).toMatchObject({
      message: ['name must be a string'],
    });
    expect(log).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
