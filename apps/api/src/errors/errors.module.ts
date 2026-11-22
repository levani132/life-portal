import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  Get,
  HttpException,
  Injectable,
  Logger,
  Module,
  Post,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { APP_FILTER, BaseExceptionFilter } from '@nestjs/core';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Model } from 'mongoose';
import { ERROR_RANGES, type ErrorGroup, type ErrorRange, type ErrorReport, type ErrorSource } from '@life-portal/shared-types';
import { addDays, errorFingerprint, isServerFault, pagePattern, scrubErrorText, scrubStack } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';

/** Records are kept this long, then Mongo deletes them. */
export const ERROR_RETENTION_DAYS = 30;
/** The most different errors recorded in one day: a storm must not fill the database. */
export const ERROR_KINDS_PER_DAY = 200;
const DAY_MS = 86_400_000;

/**
 * One kind of error on one day: what broke (scrubbed), where (a route pattern or a page), and
 * how often. Deliberately no account, no address with ids in it, no request body: enough to
 * find and fix a bug, nothing about whose data it happened on.
 */
@Schema({ collection: 'error_events', timestamps: false, versionKey: false })
export class ErrorEvent {
  @Prop({ required: true }) day!: string;
  @Prop({ required: true }) fingerprint!: string;
  @Prop({ required: true }) source!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) message!: string;
  @Prop({ required: true }) where!: string;
  @Prop() status?: number;
  @Prop() stack?: string;
  @Prop({ required: true, default: 0 }) count!: number;
  @Prop({ required: true }) lastAt!: Date;
  @Prop({ required: true }) expiresAt!: Date;
}
export const ErrorEventSchema = SchemaFactory.createForClass(ErrorEvent);
ErrorEventSchema.index({ day: 1, fingerprint: 1 }, { unique: true });
ErrorEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface ErrorInput {
  source: ErrorSource;
  name: string;
  message: string;
  where: string;
  status?: number;
  stack?: string;
}

@Injectable()
export class ErrorsService {
  private readonly logger = new Logger(ErrorsService.name);
  /** Kinds seen today, so a storm of new kinds stops being written. Per process; a soft cap. */
  private seen = { day: '', kinds: new Set<string>() };

  constructor(
    @InjectModel(ErrorEvent.name) private readonly events: Model<ErrorEvent>,
    private readonly access: AccessService,
  ) {}

  /**
   * Counts one error. Never awaited by what failed and never throws: recording a failure must
   * not become a second one. Every text is scrubbed here, whatever the caller passed.
   */
  record(input: ErrorInput, now = new Date()): void {
    try {
      const day = now.toISOString().slice(0, 10);
      const name = scrubErrorText(input.name, 80) || 'Error';
      const message = scrubErrorText(input.message) || '(no message)';
      const where = scrubErrorText(input.where, 120) || '(unknown)';
      const fingerprint = errorFingerprint({ source: input.source, name, message, where });
      if (this.seen.day !== day) this.seen = { day, kinds: new Set() };
      if (!this.seen.kinds.has(fingerprint) && this.seen.kinds.size >= ERROR_KINDS_PER_DAY) return;
      this.seen.kinds.add(fingerprint);
      const stack = scrubStack(input.stack);
      void this.events
        .updateOne(
          { day, fingerprint },
          {
            $inc: { count: 1 },
            $set: { lastAt: now, ...(stack ? { stack } : {}) },
            $setOnInsert: {
              source: input.source,
              name,
              message,
              where,
              ...(input.status ? { status: input.status } : {}),
              expiresAt: new Date(Date.parse(`${day}T00:00:00Z`) + (ERROR_RETENTION_DAYS + 1) * DAY_MS),
            },
          },
          { upsert: true },
        )
        .catch((error: unknown) => this.logger.warn(`could not record an error: ${(error as Error).message}`));
    } catch (error) {
      this.logger.warn(`could not record an error: ${(error as Error).message}`);
    }
  }

  /** Developer only: each kind of error over the last `range` days, most frequent first. */
  async report(userId: string, range: number, now = new Date()): Promise<ErrorReport> {
    this.access.requireDeveloper(userId);
    if (!ERROR_RANGES.includes(range as ErrorRange)) throw new BadRequestException('Unknown range.');
    const to = now.toISOString().slice(0, 10);
    const from = addDays(to, -(range - 1));
    const rows = await this.events.find({ day: { $gte: from, $lte: to } }).sort({ day: 1 }).limit(5000).lean();
    const groups = new Map<string, ErrorGroup>();
    for (const row of rows) {
      const group = groups.get(row.fingerprint);
      if (!group) {
        groups.set(row.fingerprint, {
          fingerprint: row.fingerprint,
          source: row.source as ErrorSource,
          name: row.name,
          message: row.message,
          where: row.where,
          ...(row.status ? { status: row.status } : {}),
          count: row.count,
          firstDay: row.day,
          lastDay: row.day,
          lastAt: row.lastAt.toISOString(),
          ...(row.stack ? { stack: row.stack } : {}),
        });
      } else {
        group.count += row.count;
        group.lastDay = row.day;
        group.lastAt = row.lastAt.toISOString();
        if (row.stack) group.stack = row.stack;
      }
    }
    const list = [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
    return { range: range as ErrorRange, total: list.reduce((sum, group) => sum + group.count, 0), groups: list };
  }
}

/**
 * Sees every failed request, records the ones that are the server's fault, and then answers
 * exactly as Nest would have: it changes nothing about the response. A 4xx is the caller's
 * doing (a refusal, a bad form) and is not recorded.
 */
@Catch()
export class RecordingExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly errors: ErrorsService) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    try {
      const status = exception instanceof HttpException ? exception.getStatus() : undefined;
      if (host.getType() === 'http' && isServerFault(status)) {
        const request = host.switchToHttp().getRequest<{ method?: string; route?: { path?: string }; baseUrl?: string }>();
        // The route's pattern (`/posts/:id`), never the address: an address carries ids.
        const where = request.route?.path ? `${request.method ?? ''} ${request.baseUrl ?? ''}${request.route.path}`.trim() : `${request.method ?? ''} (no route)`.trim();
        const error = exception instanceof Error ? exception : new Error(String(exception));
        this.errors.record({ source: 'api', name: error.name, message: error.message, where, status: status ?? 500, stack: error.stack });
      }
    } catch {
      /* Recording never gets in the way of answering. */
    }
    super.catch(exception, host);
  }
}

export class ClientErrorDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(2000) message!: string;
  @IsOptional() @IsString() @MaxLength(8000) stack?: string;
  @IsString() @MaxLength(500) page!: string;
}

export class ErrorReportDto {
  @Type(() => Number) @IsIn(ERROR_RANGES) range = 7;
}

@Controller('errors')
export class ErrorsController {
  /** Reports per account per minute: a page stuck in an error loop must not flood the log. */
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly errors: ErrorsService) {}

  /** Something broke on a signed-in person's page. Who it was is not kept. */
  @Post('client') client(@CurrentUser('userId') userId: string, @Body() dto: ClientErrorDto): { ok: true } {
    const now = Date.now();
    const times = (this.recent.get(userId) ?? []).filter((time) => now - time < 60_000);
    if (times.length < 10) {
      times.push(now);
      this.errors.record({ source: 'web', name: dto.name, message: dto.message, where: pagePattern(dto.page), stack: dto.stack });
    }
    this.recent.set(userId, times);
    if (this.recent.size > 5000) this.recent.clear();
    return { ok: true };
  }

  /** Developer only. */
  @Get() report(@CurrentUser('userId') userId: string, @Query() query: ErrorReportDto) {
    return this.errors.report(userId, query.range);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: ErrorEvent.name, schema: ErrorEventSchema }])],
  controllers: [ErrorsController],
  providers: [ErrorsService, { provide: APP_FILTER, useClass: RecordingExceptionFilter }],
  exports: [ErrorsService],
})
export class ErrorsModule {}
