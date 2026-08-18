import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { toDay } from '@life-portal/shared-domain';

/**
 * Resolves the reference "today" for a request.
 *
 * Projections take "today" as an explicit argument (constitution principle V), so it enters
 * the system in exactly one place. An optional `?today=YYYY-MM-DD` override exists so the UI
 * can ask "what does this look like on 1 December?" and so tests are deterministic.
 */
export function resolveToday(override?: unknown): string {
  if (override == null || override === '') {
    return new Date().toISOString().slice(0, 10);
  }
  if (typeof override !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(override)) {
    throw new BadRequestException('`today` must be a calendar date in YYYY-MM-DD form');
  }
  return toDay(override);
}

/** Injects the resolved `today` into a controller method. */
export const Today = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ query?: Record<string, unknown> }>();
  return resolveToday(request.query?.['today']);
});
