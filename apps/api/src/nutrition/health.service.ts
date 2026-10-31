import {
  HEALTH_BATCH_LIMIT,
  healthWindowResponse,
  planHealthWindows,
  splitHealthWindow,
  type HealthWindow,
} from './health-batch';
import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Injectable,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsInt,
  Matches,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type, Transform, plainToInstance } from 'class-transformer';
import { createHash, randomBytes } from 'crypto';
import { addDays } from '@life-portal/shared-domain';
import type { HealthSample } from '@life-portal/shared-types';
import { normalizeHealthSamples } from './health-samples-input';
import { CurrentUser, TokenAuth } from '../auth/current-user.decorator';
import { AccessService, RequireModule } from '../access/access.module';

@Schema({ collection: 'nutrition_health', timestamps: true })
export class HealthConnection {
  @Prop({ required: true, unique: true }) userId!: string;
  @Prop({ default: false }) paired!: boolean;
  @Prop() ticketHash?: string;
  @Prop() expiresAt?: string;
  @Prop() lastLaunch?: string;
  @Prop() uploadingUntil?: string;
  @Prop() from?: string;
  @Prop() to?: string;
  @Prop() lastSync?: string;
  @Prop() batchTicketHash?: string;
  @Prop() batchExpiresAt?: string;
  @Prop() batchPlannedTo?: string;
  @Prop() batchLastReceipt?: string;
  @Prop() batchWriteId?: string;
  @Prop({ type: [Object], default: undefined }) batchQueue?: HealthWindow[];
  @Prop({ type: [String], default: undefined }) batchAcknowledgedIds?: string[];
}
@Schema({ collection: 'nutrition_health_days' })
export class HealthDay {
  @Prop({ required: true }) connectionId!: string;
  @Prop({ required: true }) userId!: string;
  @Prop({ required: true }) day!: string;
  @Prop({ type: [Object], default: [] }) samples!: HealthSample[];
}
export const HealthDaySchema = SchemaFactory.createForClass(HealthDay);
HealthDaySchema.index({ userId: 1, connectionId: 1, day: 1 }, { unique: true });
export const HealthConnectionSchema =
  SchemaFactory.createForClass(HealthConnection);
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
class SampleDto implements HealthSample {
  @IsString() @MaxLength(200) id!: string;
  @IsIn(['activeEnergy', 'steps', 'workout']) type!: HealthSample['type'];
  @IsString() @MaxLength(200) source!: string;
  @IsString() @MaxLength(40) unit!: string;
  @IsISO8601({ strict: true }) start!: string;
  @IsISO8601({ strict: true }) end!: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1000000) value!: number;
}
export class HealthUploadDto {
  // Normalize transport formats before applying the same nested sample validation.
  @Transform(
    ({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
      const rows = normalizeHealthSamples(
        value,
        (obj.activeCount === 0 || obj.activeCount === '0') &&
          (obj.stepCount === 0 || obj.stepCount === '0'),
      );
      return Array.isArray(rows) ? plainToInstance(SampleDto, rows) : rows;
    },
    { toClassOnly: true },
  )
  @IsArray()
  @ArrayMaxSize(3000)
  @ValidateNested({ each: true })
  @Type(() => SampleDto)
  samples!: SampleDto[];
}
export class HealthBatchUploadDto extends HealthUploadDto {
  @Matches(/^[a-f0-9]{32}$/) windowId!: string;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(HEALTH_BATCH_LIMIT)
  activeCount!: number;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(HEALTH_BATCH_LIMIT)
  stepCount!: number;
}
@Injectable()
export class HealthService {
  constructor(
    @InjectModel(HealthConnection.name)
    private readonly model: Model<HealthConnection>,
    @InjectModel(HealthDay.name) private readonly days: Model<HealthDay>,
    private readonly access: AccessService,
  ) {}
  async status(userId: string) {
    const row = await this.model.findOne({ userId }).lean();
    const configured = process.env['APPLE_HEALTH_SHORTCUT_URL'];
    const installationUrl =
      configured &&
      /^https:\/\/www\.icloud\.com\/shortcuts\/[a-f0-9]{32}$/i.test(configured)
        ? configured
        : undefined;
    return {
      paired: row?.paired ?? false,
      lastSync: row?.lastSync,
      installationUrl,
      ...(row?.batchLastReceipt
        ? {
            pendingWindows: row.batchQueue?.length ?? 0,
            batchLastReceipt: row.batchLastReceipt,
            batchBlocked: row.batchQueue?.[0]?.blocked ?? false,
          }
        : {}),
    };
  }
  async data(userId: string, day: string) {
    const connection = await this.model
      .findOne({ userId, paired: true })
      .lean();
    if (!connection) return null;
    const days = await this.days
      .find({
        userId,
        connectionId: String(connection._id),
        day: { $gte: addDays(day, -4), $lte: addDays(day, 1) },
      })
      .lean();
    return {
      lastSync: connection.lastSync,
      samples: days.flatMap((d) => d.samples),
    };
  }

  async pair(userId: string) {
    await this.model.updateOne(
      { userId },
      { $set: { paired: true } },
      { upsert: true },
    );
    return this.status(userId);
  }
  async revoke(userId: string) {
    await this.model.deleteOne({ userId });
    await this.days.deleteMany({ userId });
    return { paired: false };
  }
  async launch(userId: string) {
    const token = randomBytes(32).toString('base64url');
    const now = Math.floor(Date.now() / 1000) * 1000;
    const from = new Date(now - 72 * 3600000).toISOString(),
      to = new Date(now).toISOString();
    const row = await this.model.findOneAndUpdate(
      {
        userId,
        paired: true,
        $and: [
          {
            $or: [
              { lastLaunch: { $exists: false } },
              { lastLaunch: { $lt: new Date(now - 15000).toISOString() } },
            ],
          },
          {
            $or: [
              { uploadingUntil: { $exists: false } },
              { uploadingUntil: { $lt: to } },
            ],
          },
        ],
      },
      {
        $set: {
          lastLaunch: to,
          ticketHash: hash(token),
          expiresAt: new Date(now + 15 * 60000).toISOString(),
          from,
          to,
        },
      },
    );
    if (!row) throw new BadRequestException('Pair Apple Health first.');
    // Legacy Shortcuts keep their one-use snapshot upload. The updated Shortcut uses
    // this separate bounded session credential for acknowledged windows instead.
    await this.model.updateOne(
      { userId, paired: true, ticketHash: hash(token) },
      {
        $set: {
          batchTicketHash: hash(token),
          batchExpiresAt: new Date(now + 15 * 60000).toISOString(),
          batchPlannedTo: to,
          batchQueue: planHealthWindows(to, row.batchPlannedTo, row.batchQueue),
          batchAcknowledgedIds: [],
        },
      },
    );
    return { token, from, to, batchProtocol: 2 };
  }
  async verify(token?: string) {
    if (typeof token !== 'string' || !token || token.length > 100)
      throw new UnauthorizedException('Missing Health upload ticket.');
    const row = await this.model
      .findOne({
        ticketHash: hash(token),
        paired: true,
        expiresAt: { $gt: new Date().toISOString() },
      })
      .lean();
    if (!row || !row.from || !row.to)
      throw new UnauthorizedException(
        'Expired, used or revoked Health upload ticket.',
      );
    await this.access.require(row.userId, 'nutrition');
    return {
      userId: row.userId,
      connectionId: String(row._id),
      ticketHash: hash(token),
      from: row.from,
      to: row.to,
    };
  }
  async upload(owner: HealthOwner, dto: HealthUploadDto) {
    for (const s of dto.samples) {
      const start = Date.parse(s.start),
        end = Date.parse(s.end);
      if (
        !s.id.trim() ||
        !s.source.trim() ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(s.start) ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(s.end) ||
        end <= start ||
        end > Date.parse(owner.to) ||
        start < Date.parse(owner.from)
      )
        throw new BadRequestException(
          'Samples need a source, id and bounded absolute start/end times.',
        );
    }
    const normalized = dto.samples.map((s) => {
      const unit = s.unit.toLowerCase();
      if (s.type === 'activeEnergy' && !['kcal', 'cal', 'kj'].includes(unit))
        throw new BadRequestException(
          'Active energy must be exported in kcal or kJ.',
        );
      if (s.type === 'steps' && !['count', 'steps', 'step', ''].includes(unit))
        throw new BadRequestException('Steps must be counts.');
      return {
        id: s.id,
        type: s.type,
        source: s.source,
        start: new Date(s.start).toISOString(),
        end: new Date(s.end).toISOString(),
        value:
          s.type === 'activeEnergy' && unit === 'kj'
            ? s.value / 4.184
            : s.value,
      };
    });
    const unique = [
      ...new Map(
        normalized.map((s) => [`${s.type}:${s.source}:${s.id}`, s]),
      ).values(),
    ];
    // Consume exactly once before writing. Daily snapshots retain historical source data.
    const row = await this.model.findOneAndUpdate(
      {
        _id: owner.connectionId,
        userId: owner.userId,
        paired: true,
        ticketHash: owner.ticketHash,
        expiresAt: { $gt: new Date().toISOString() },
      },
      {
        $set: { uploadingUntil: new Date(Date.now() + 60000).toISOString() },
        $unset: { ticketHash: 1, expiresAt: 1 },
      },
    );
    if (!row)
      throw new UnauthorizedException('Upload ticket already used or revoked.');
    await this.storeWindow(owner, unique);
    // Revocation during upload must not restore the connection or mark sync successful.
    await this.model.updateOne(
      { _id: owner.connectionId, userId: owner.userId, paired: true },
      {
        $set: { lastSync: new Date().toISOString() },
        $unset: { uploadingUntil: 1 },
      },
    );
    if (
      !(await this.model.exists({
        _id: owner.connectionId,
        userId: owner.userId,
        paired: true,
      }))
    )
      await this.days.deleteMany({
        userId: owner.userId,
        connectionId: owner.connectionId,
      });
    return { received: unique.length };
  }
  private async storeWindow(
    owner: HealthOwner,
    rows: HealthSample[],
    byStart = false,
  ) {
    const first = owner.from.slice(0, 10),
      last = owner.to.slice(0, 10);
    // Missing/denied Health access is indistinguishable from an empty query. In batch
    // mode replace matching record IDs only; never erase known activity based on absence.
    const keep = byStart
      ? {
          $not: [
            {
              $in: [
                { $concat: ['$$s.type', ':', '$$s.source', ':', '$$s.id'] },
                rows.map((s) => `${s.type}:${s.source}:${s.id}`),
              ],
            },
          ],
        }
      : {
          $or: [
            { $lt: ['$$s.start', owner.from] },
            { $gt: ['$$s.end', owner.to] },
          ],
        };
    for (let day = first; day <= last; day = addDays(day, 1)) {
      const samples = rows.filter((s) => s.start.slice(0, 10) === day);
      await this.days.updateOne(
        { userId: owner.userId, connectionId: owner.connectionId, day },
        [
          {
            $set: {
              connectionId: { $literal: owner.connectionId },
              userId: { $literal: owner.userId },
              day: { $literal: day },
              samples: {
                $concatArrays: [
                  {
                    $filter: {
                      input: { $ifNull: ['$samples', []] },
                      as: 's',
                      cond: keep,
                    },
                  },
                  { $literal: samples },
                ],
              },
            },
          },
        ],
        { upsert: true, updatePipeline: true },
      );
    }
  }
  async verifyBatch(token?: string) {
    if (typeof token !== 'string' || !token || token.length > 100)
      throw new UnauthorizedException('Missing Health batch ticket.');
    const row = await this.model
      .findOne({
        batchTicketHash: hash(token),
        paired: true,
        batchExpiresAt: { $gt: new Date().toISOString() },
      })
      .lean();
    if (!row || !row.batchPlannedTo)
      throw new UnauthorizedException(
        'Expired or revoked Health batch session.',
      );
    await this.access.require(row.userId, 'nutrition');
    return {
      userId: row.userId,
      connectionId: String(row._id),
      ticketHash: hash(token),
      from: row.from ?? '',
      to: row.batchPlannedTo,
    };
  }
  private batchFilter(owner: HealthOwner) {
    return {
      _id: owner.connectionId,
      userId: owner.userId,
      paired: true,
      batchTicketHash: owner.ticketHash,
      batchExpiresAt: { $gt: new Date().toISOString() },
    };
  }
  async batchNext(owner: HealthOwner) {
    const row = await this.model.findOne(this.batchFilter(owner)).lean();
    if (!row)
      throw new UnauthorizedException(
        'Expired or revoked Health batch session.',
      );
    return healthWindowResponse(row.batchQueue ?? []);
  }
  async batchUpload(owner: HealthOwner, dto: HealthBatchUploadDto) {
    const filter = this.batchFilter(owner);
    const current = await this.model.findOne(filter).lean();
    if (!current)
      throw new UnauthorizedException(
        'Expired or revoked Health batch session.',
      );
    // A lost response may be retried; already acknowledged windows are never written twice.
    if (current.batchAcknowledgedIds?.includes(dto.windowId))
      return {
        acknowledged: dto.windowId,
        ...healthWindowResponse(current.batchQueue ?? []),
      };
    const w = current.batchQueue?.[0];
    if (!w || w.id !== dto.windowId || w.blocked)
      throw new BadRequestException(
        'Request the pending Health window before uploading.',
      );
    Logger.log(
      `batch samples received records=${dto.samples.length} activeCount=${dto.activeCount} stepCount=${dto.stepCount}`,
      'HealthUpload',
    );
    const truncated =
      dto.activeCount >= HEALTH_BATCH_LIMIT ||
      dto.stepCount >= HEALTH_BATCH_LIMIT;
    if (
      !truncated &&
      (dto.samples.filter((s) => s.type === 'activeEnergy').length !==
        dto.activeCount ||
        dto.samples.filter((s) => s.type === 'steps').length !==
          dto.stepCount ||
        dto.samples.length !== dto.activeCount + dto.stepCount)
    )
      throw new BadRequestException(
        'Health batch counts must match active-energy and step records.',
      );
    const rows: HealthSample[] = [];
    if (!truncated)
      for (const s of dto.samples) {
        const start = Date.parse(s.start),
          end = Date.parse(s.end);
        const unit = s.unit.toLowerCase();
        if (
          !s.id.trim() ||
          !s.source.trim() ||
          !/(Z|[+-]\d{2}:\d{2})$/.test(s.start) ||
          !/(Z|[+-]\d{2}:\d{2})$/.test(s.end) ||
          end <= start ||
          end > Date.parse(owner.to) ||
          start < Date.parse(w.from) - 1000 ||
          start >= Date.parse(w.to)
        )
          throw new BadRequestException(
            'Health samples must match the requested absolute time window.',
          );
        if (s.type === 'activeEnergy' && !['kcal', 'cal', 'kj'].includes(unit))
          throw new BadRequestException(
            'Active energy must be exported in kcal or kJ.',
          );
        if (
          s.type === 'steps' &&
          !['count', 'steps', 'step', ''].includes(unit)
        )
          throw new BadRequestException('Steps must be counts.');
        // Find's strict-after predicate gets a one-second query overlap; adjacent windows own those edge records.
        if (start < Date.parse(w.from)) continue;
        rows.push({
          id: s.id,
          type: s.type,
          source: s.source,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          value:
            s.type === 'activeEnergy' && unit === 'kj'
              ? s.value / 4.184
              : s.value,
        });
      }
    const writeId = randomBytes(16).toString('hex');
    const acquired = await this.model.findOneAndUpdate(
      {
        ...filter,
        'batchQueue.0.id': w.id,
        $or: [
          { uploadingUntil: { $exists: false } },
          { uploadingUntil: { $lt: new Date().toISOString() } },
        ],
      },
      {
        $set: {
          uploadingUntil: new Date(Date.now() + 60000).toISOString(),
          batchWriteId: writeId,
        },
      },
    );
    if (!acquired)
      throw new BadRequestException(
        'A Health batch is already processing; retry this window.',
      );
    try {
      const queue = [
        ...(truncated ? splitHealthWindow(w) : []),
        ...(current.batchQueue ?? []).slice(1),
      ];
      if (!truncated)
        await this.storeWindow(
          { ...owner, from: w.from, to: w.to },
          [
            ...new Map(
              rows.map((s) => [`${s.type}:${s.source}:${s.id}`, s]),
            ).values(),
          ],
          true,
        );
      const acknowledged =
        truncated && queue[0]?.blocked
          ? (current.batchAcknowledgedIds ?? [])
          : [...(current.batchAcknowledgedIds ?? []), w.id].slice(-256);
      const receiptAt = new Date().toISOString();
      const saved = await this.model.findOneAndUpdate(
        { ...filter, batchWriteId: writeId, 'batchQueue.0.id': w.id },
        {
          $set: {
            batchQueue: queue,
            batchAcknowledgedIds: acknowledged,
            batchLastReceipt: receiptAt,
            ...(!truncated ? { lastSync: receiptAt } : {}),
          },
        },
      );
      if (!saved)
        throw new UnauthorizedException(
          'Health connection changed during upload; pending work can be resumed.',
        );
      Logger.log(
        `batch ${truncated ? 'split' : 'acknowledged'} records=${rows.length} remaining=${queue.length}`,
        'HealthUpload',
      );
      return {
        acknowledged: w.id,
        split: truncated,
        ...healthWindowResponse(queue),
      };
    } finally {
      await this.model.updateOne(
        {
          _id: owner.connectionId,
          userId: owner.userId,
          batchWriteId: writeId,
        },
        { $unset: { uploadingUntil: 1, batchWriteId: 1 } },
      );
      if (
        !(await this.model.exists({
          _id: owner.connectionId,
          userId: owner.userId,
          paired: true,
        }))
      )
        await this.days.deleteMany({
          userId: owner.userId,
          connectionId: owner.connectionId,
        });
    }
  }
}
interface HealthOwner {
  connectionId: string;
  userId: string;
  ticketHash: string;
  from: string;
  to: string;
}
@Injectable()
export class HealthUploadGuard implements CanActivate {
  constructor(private readonly health: HealthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      healthOwner: HealthOwner;
    }>();
    Logger.log(
      `[upload] guard entered: ${JSON.stringify({
        hasTicket: !!req.headers['x-health-ticket'],
        contentType: req.headers['content-type'],
        contentLength: req.headers['content-length'],
      })}`,
    );
    req.healthOwner = await this.health.verify(req.headers['x-health-ticket']);
    Logger.log('[upload] ticket verified');
    return true;
  }
}
@Injectable()
export class HealthBatchGuard implements CanActivate {
  constructor(private readonly health: HealthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      healthOwner: HealthOwner;
    }>();
    req.healthOwner = await this.health.verifyBatch(
      req.headers['x-health-ticket'],
    );
    return true;
  }
}
@RequireModule('nutrition')
@Controller('nutrition/health')
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get() status(@CurrentUser('userId') userId: string) {
    return this.health.status(userId);
  }
  @Post('pair') pair(@CurrentUser('userId') userId: string) {
    return this.health.pair(userId);
  }
  @Delete() revoke(@CurrentUser('userId') userId: string) {
    return this.health.revoke(userId);
  }
  @Post('launch') launch(@CurrentUser('userId') userId: string) {
    return this.health.launch(userId);
  }
  @TokenAuth()
  @UseGuards(HealthBatchGuard)
  @Post('batch/next')
  batchNext(@Req() req: { healthOwner: HealthOwner }) {
    return this.health.batchNext(req.healthOwner);
  }
  @TokenAuth()
  @UseGuards(HealthBatchGuard)
  @Post('batch/upload')
  batchUpload(
    @Req() req: { healthOwner: HealthOwner },
    @Body() dto: HealthBatchUploadDto,
  ) {
    return this.health.batchUpload(req.healthOwner, dto);
  }
  @TokenAuth()
  @UseGuards(HealthUploadGuard)
  @Post('upload')
  upload(
    @Req() req: { healthOwner: HealthOwner },
    @Body() dto: HealthUploadDto,
  ) {
    Logger.log(
      `[upload] controller entered: ${JSON.stringify({
        sampleCount: dto?.samples?.length,
      })}`,
    );
    return this.health.upload(req.healthOwner, dto);
  }
}
