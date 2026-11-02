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
import { HealthShortcutSettingsService } from './health-shortcut-settings';
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
  @Prop() lastSync?: string;
  @Prop() lastUploadAt?: string;
  @Prop() lastReceivedCount?: number;
  @Prop() uploadWriteId?: string;
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
  @IsIn(['activeEnergy', 'steps']) type!: HealthSample['type'];
  @IsString() @MaxLength(200) source!: string;
  @IsString() @MaxLength(40) unit!: string;
  @IsISO8601({ strict: true }) start!: string;
  @IsISO8601({ strict: true }) end!: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1000000) value!: number;
}
export const HEALTH_RECENT_LIMIT = 50;
export class HealthUploadDto {
  @Transform(
    ({ value }: { value: unknown }) => {
      // Empty text is a valid empty recent snapshot; it never deletes stored history.
      const rows = normalizeHealthSamples(value, true);
      return Array.isArray(rows) ? plainToInstance(SampleDto, rows) : rows;
    },
    { toClassOnly: true },
  )
  @IsArray()
  @ArrayMaxSize(HEALTH_RECENT_LIMIT * 2)
  @ValidateNested({ each: true })
  @Type(() => SampleDto)
  samples!: SampleDto[];
}
@Injectable()
export class HealthService {
  constructor(
    @InjectModel(HealthConnection.name)
    private readonly model: Model<HealthConnection>,
    @InjectModel(HealthDay.name) private readonly days: Model<HealthDay>,
    private readonly access: AccessService,
    private readonly shortcutSettings: HealthShortcutSettingsService,
  ) {}
  async status(userId: string) {
    const row = await this.model.findOne({ userId }).lean();
    const installationUrl = await this.shortcutSettings.getUrl();
    return {
      paired: row?.paired ?? false,
      lastSync: row?.lastSync,
      installationUrl,
      mode: 'recent' as const,
      limitPerKind: HEALTH_RECENT_LIMIT,
      lastUploadAt: row?.lastUploadAt,
      lastReceivedCount: row?.lastReceivedCount,
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
    const now = Date.now();
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
              { uploadingUntil: { $lt: new Date(now).toISOString() } },
            ],
          },
        ],
      },
      {
        $set: {
          lastLaunch: new Date(now).toISOString(),
          ticketHash: hash(token),
          expiresAt: new Date(now + 15 * 60000).toISOString(),
        },
        // Retire only obsolete protocol metadata. Uploaded samples are kept.
        $unset: {
          from: 1,
          to: 1,
          batchTicketHash: 1,
          batchExpiresAt: 1,
          batchPlannedTo: 1,
          batchQueue: 1,
          batchAcknowledgedIds: 1,
          batchLastReceipt: 1,
          batchWriteId: 1,
        },
      },
      { strict: false }, // Allow cleanup of retired queue fields no longer in the schema.
    );
    if (!row)
      throw new BadRequestException(
        'Pair Apple Health first, or wait a few seconds before retrying.',
      );
    return { token, limitPerKind: HEALTH_RECENT_LIMIT };
  }
  async verify(token?: string): Promise<HealthOwner> {
    if (typeof token !== 'string' || !token || token.length > 100)
      throw new UnauthorizedException('Missing Health upload ticket.');
    const row = await this.model
      .findOne({
        ticketHash: hash(token),
        paired: true,
        expiresAt: { $gt: new Date().toISOString() },
      })
      .lean();
    if (!row)
      throw new UnauthorizedException(
        'Expired, used or revoked Health upload ticket.',
      );
    await this.access.require(row.userId, 'nutrition');
    return {
      userId: row.userId,
      connectionId: String(row._id),
      ticketHash: hash(token),
    };
  }
  async upload(owner: HealthOwner, dto: HealthUploadDto) {
    const activeCount = dto.samples.filter(
      (s) => s.type === 'activeEnergy',
    ).length;
    const stepCount = dto.samples.filter((s) => s.type === 'steps').length;
    if (
      activeCount > HEALTH_RECENT_LIMIT ||
      stepCount > HEALTH_RECENT_LIMIT ||
      activeCount + stepCount !== dto.samples.length
    )
      throw new BadRequestException(
        `Send at most ${HEALTH_RECENT_LIMIT} Active Energy and ${HEALTH_RECENT_LIMIT} Steps samples.`,
      );
    const normalized: HealthSample[] = dto.samples.map((s) => {
      const start = Date.parse(s.start),
        end = Date.parse(s.end);
      if (
        !s.id.trim() ||
        !s.source.trim() ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(s.start) ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(s.end) ||
        end < start ||
        end > Date.now() + 60000
      )
        throw new BadRequestException(
          'Samples need a source, id and valid absolute start/end times, without future dates.',
        );
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
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
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
    const writeId = randomBytes(16).toString('hex');
    const filter = {
      _id: owner.connectionId,
      userId: owner.userId,
      paired: true,
      ticketHash: owner.ticketHash,
      expiresAt: { $gt: new Date().toISOString() },
    };
    const acquired = await this.model.findOneAndUpdate(
      {
        ...filter,
        $or: [
          { uploadingUntil: { $exists: false } },
          { uploadingUntil: { $lt: new Date().toISOString() } },
        ],
      },
      {
        $set: {
          uploadingUntil: new Date(Date.now() + 60000).toISOString(),
          uploadWriteId: writeId,
        },
      },
    );
    if (!acquired)
      throw new UnauthorizedException(
        'Upload ticket already used, processing or revoked.',
      );
    try {
      await this.storeSamples(owner, unique);
      const receivedAt = new Date().toISOString();
      const saved = await this.model.findOneAndUpdate(
        { ...filter, uploadWriteId: writeId },
        {
          $set: {
            lastUploadAt: receivedAt,
            lastReceivedCount: unique.length,
            ...(unique.length ? { lastSync: receivedAt } : {}),
          },
          $unset: {
            ticketHash: 1,
            expiresAt: 1,
            uploadingUntil: 1,
            uploadWriteId: 1,
          },
        },
      );
      if (!saved)
        throw new UnauthorizedException(
          'Health connection changed during upload.',
        );
      Logger.log(
        `recent upload stored=${unique.length} activeCount=${activeCount} stepCount=${stepCount}`,
        'HealthUpload',
      );
      return { received: unique.length, limitPerKind: HEALTH_RECENT_LIMIT };
    } finally {
      // Keep the ticket available after a failed write; repeated samples merge by identity.
      await this.model.updateOne(
        {
          _id: owner.connectionId,
          userId: owner.userId,
          uploadWriteId: writeId,
        },
        { $unset: { uploadingUntil: 1, uploadWriteId: 1 } },
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
  private async storeSamples(owner: HealthOwner, rows: HealthSample[]) {
    const groups = new Map<string, HealthSample[]>();
    for (const row of rows) {
      const day = row.start.slice(0, 10);
      groups.set(day, [...(groups.get(day) ?? []), row]);
    }
    for (const [day, samples] of groups) {
      const identities = samples.map((s) => `${s.type}:${s.source}:${s.id}`);
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
                      cond: {
                        $not: [
                          {
                            $in: [
                              {
                                $concat: [
                                  '$$s.type',
                                  ':',
                                  '$$s.source',
                                  ':',
                                  '$$s.id',
                                ],
                              },
                              identities,
                            ],
                          },
                        ],
                      },
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
}
interface HealthOwner {
  userId: string;
  connectionId: string;
  ticketHash: string;
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
