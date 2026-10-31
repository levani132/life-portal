import { Logger, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { HealthUploadDto } from './health.service';

const defaultException = new ValidationPipe().createExceptionFactory();
const allowedFields = new Set([
  'samples',
  'id',
  'type',
  'source',
  'unit',
  'start',
  'end',
  'value',
]);

/** Log schema paths and failed rules only, never rejected values or arbitrary input keys. */
export function healthValidationException(errors: ValidationError[]) {
  const target = errors.find((error) => error.target instanceof HealthUploadDto)
    ?.target as HealthUploadDto | undefined;
  if (target) {
    const issues: string[] = [];
    const visit = (rows: ValidationError[], prefix = '') => {
      for (const error of rows) {
        if (issues.length >= 20) return;
        const field =
          allowedFields.has(error.property) || /^\d{1,4}$/.test(error.property)
            ? error.property
            : '<unknown-field>';
        const path = prefix ? `${prefix}.${field}` : field;
        if (error.constraints)
          issues.push(`${path}: ${Object.keys(error.constraints).join(',')}`);
        if (error.children) visit(error.children, path);
      }
    };
    visit(errors);
    Logger.warn(
      `validation rejected samplesShape=${Array.isArray(target.samples) ? 'array' : typeof target.samples} issues=${JSON.stringify(issues)}`,
      'HealthUpload',
    );
  }
  return defaultException(errors);
}
