import { Logger } from '@nestjs/common';

const fields = ['id', 'type', 'source', 'unit', 'start', 'end', 'value'];
const shape = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

/** Accept Shortcut transport variations without treating unparseable data as empty. */
export function normalizeHealthSamples(
  input: unknown,
  allowEmptyText = false,
): unknown {
  let value = input;
  const conversions: string[] = [];
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth++) {
    const text = value.trim();
    if (!text && allowEmptyText) {
      value = [];
      conversions.push('empty-text');
      break;
    }
    try {
      value = JSON.parse(text);
      conversions.push('json');
    } catch {
      // Shortcuts may join dictionary items with newlines when used in a Text field.
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length > 1 && lines.length <= 3000) {
        try {
          const rows: unknown[] = lines.map((line) => JSON.parse(line));
          if (
            rows.every(
              (row) =>
                row !== null && typeof row === 'object' && !Array.isArray(row),
            )
          ) {
            value = rows;
            conversions.push('json-lines');
          }
        } catch {
          /* Leave the original value for validation to reject. */
        }
      }
      break;
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    value = [value];
    conversions.push('single-dictionary');
  }
  if (Array.isArray(value) && value.length <= 3000) {
    value = value.map((row: unknown) => {
      if (typeof row !== 'string') return row;
      try {
        const parsed: unknown = JSON.parse(row);
        return parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
          ? parsed
          : row;
      } catch {
        return row;
      }
    });
  }
  // Field types reveal accidental Text coercion without exposing health records or IDs.
  const preview = Array.isArray(value)
    ? value.slice(0, 2).map((row: unknown) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row))
          return { shape: shape(row) };
        const record = row as Record<string, unknown>;
        return {
          shape: 'object',
          fields: Object.fromEntries(
            fields
              .filter((key) =>
                Object.prototype.hasOwnProperty.call(record, key),
              )
              .map((key) => [key, shape(record[key])]),
          ),
          unknownFieldCount: Object.keys(record).filter(
            (key) => !fields.includes(key),
          ).length,
        };
      })
    : undefined;
  Logger.log(
    `samples input=${JSON.stringify({
      shape: shape(input),
      textLength: typeof input === 'string' ? input.length : undefined,
      blankText: typeof input === 'string' ? !input.trim() : undefined,
      conversions,
      outputShape: shape(value),
      count: Array.isArray(value) ? value.length : undefined,
      preview,
      unparseable: typeof value === 'string',
    })}`,
    'HealthUpload',
  );
  return value;
}
