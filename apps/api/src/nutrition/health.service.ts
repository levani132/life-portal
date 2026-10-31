import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Injectable,
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
import { Type } from 'class-transformer';
import { createHash, randomBytes } from 'crypto';
import { addDays } from '@life-portal/shared-domain';
import type { HealthSample } from '@life-portal/shared-types';
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
  @IsArray()
  @ArrayMaxSize(3000)
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
    return { token, from, to };
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
    const first = owner.from.slice(0, 10),
      last = owner.to.slice(0, 10);
    for (let day = first; day <= last; day = addDays(day, 1)) {
      const samples = unique.filter((s) => s.start.slice(0, 10) === day);
      // A snapshot replaces only its matching time range; old days and uncertain edges survive.
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
                        $or: [
                          { $lt: ['$$s.start', owner.from] },
                          { $gt: ['$$s.end', owner.to] },
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
    req.healthOwner = await this.health.verify(req.headers['x-health-ticket']);
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
    return this.health.upload(req.healthOwner, dto);
  }
}
