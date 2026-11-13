import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Global,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Put,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectModel,
  MongooseModule,
  Prop,
  Schema,
  SchemaFactory,
} from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  IsBoolean,
  IsIn,
  ValidateIf,
  IsDefined,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  COHORTS,
  DEFAULT_OFF_FEATURES,
  type AccessUser,
  type CohortPolicy,
  type FeatureAccess,
  type FeatureId,
  type UserCohort,
} from '@life-portal/shared-types';
import { resolveFeatureAccess } from '@life-portal/shared-domain';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { CurrentUser } from '../auth/current-user.decorator';
import { CONFIG, type AppConfig } from '../config/configuration';

const REQUIRED_MODULE = 'portal:module';
export const RequireModule = (id: FeatureId) => SetMetadata(REQUIRED_MODULE, id);
@Schema({ collection: 'feature_policies', timestamps: true })
class FeaturePolicy {
  @Prop({ type: String, required: true, unique: true, enum: COHORTS })
  cohort!: UserCohort;
  @Prop({ type: Object, default: {} }) overrides!: Partial<FeatureAccess>;
}
const FeaturePolicySchema = SchemaFactory.createForClass(FeaturePolicy);
class FeatureOverridesDto {
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() foodPosts?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() push?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() messages?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() postMedia?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() forYou?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() trainingLevels?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() forYouRanking?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() forYouMetrics?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() trainingRanks?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() training?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsBoolean() social?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  nutrition?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  money?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  stocks?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  loans?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  items?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  personal?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  projects?: boolean;
}
class UpdateAccessDto {
  @IsIn(COHORTS) cohort!: UserCohort;
  /** Replaces overrides, so an empty object restores cohort defaults. */
  @IsDefined()
  @ValidateNested()
  @Type(() => FeatureOverridesDto)
  overrides!: FeatureOverridesDto;
}
@Injectable()
export class AccessService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @Inject(CONFIG) private readonly config: AppConfig,
    @InjectModel(FeaturePolicy.name)
    private readonly policies: Model<FeaturePolicy>,
  ) {}
  async forUser(userId: string) {
    const user = await this.users
      .findById(userId)
      .select('cohort featureOverrides')
      .lean();
    if (!user) throw new UnauthorizedException('Account not found.');
    const cohort: UserCohort | 'developer' =
      userId === this.config.developerUserId
        ? 'developer'
        : (user.cohort ?? 'internal');
    // The developer has every feature, except default-off ones (#11), which follow the internal
    // group's policy: turning measurement on for internal accounts is what turns it on there.
    const policy = await this.policies
      .findOne({ cohort: cohort === 'developer' ? 'internal' : cohort })
      .lean();
    const overrides =
      cohort === 'developer'
        ? Object.fromEntries(
            DEFAULT_OFF_FEATURES.map((id) => [id, policy?.overrides?.[id]]),
          )
        : { ...policy?.overrides, ...user.featureOverrides };
    return { cohort, access: resolveFeatureAccess(cohort, overrides) };
  }
  async require(userId: string, module: FeatureId) {
    if (!(await this.forUser(userId)).access[module])
      throw new ForbiddenException(
        'This module is not available for your account.',
      );
  }
  requireDeveloper(userId: string) {
    if (!this.config.developerUserId || userId !== this.config.developerUserId)
      throw new ForbiddenException('Developer access required.');
  }
  async getPolicies(userId: string): Promise<CohortPolicy[]> {
    this.requireDeveloper(userId);
    const policies = await this.policies.find().lean();
    // Resolved, so the admin sees and owns a concrete value for every feature. A feature the
    // admin has never saved for a group shows (and behaves as) the code fallback until saved.
    return COHORTS.map((cohort) => ({
      cohort,
      access: resolveFeatureAccess(
        cohort,
        policies.find((p) => p.cohort === cohort)?.overrides,
      ),
    }));
  }
  async updatePolicy(userId: string, dto: UpdateAccessDto) {
    this.requireDeveloper(userId);
    await this.policies.findOneAndUpdate(
      { cohort: dto.cohort },
      { $set: { overrides: dto.overrides } },
      { upsert: true },
    );
    return { success: true };
  }
  async listUsers(userId: string): Promise<AccessUser[]> {
    this.requireDeveloper(userId);
    const users = await this.users
      .find()
      .select('name cohort featureOverrides')
      .sort({ name: 1 })
      .limit(200)
      .lean();
    return users.map((user) => ({
      id: String(user._id),
      name: user.name,
      cohort:
        String(user._id) === this.config.developerUserId
          ? 'developer'
          : (user.cohort ?? 'internal'),
      overrides: user.featureOverrides ?? {},
    }));
  }
  async update(userId: string, targetId: string, dto: UpdateAccessDto) {
    this.requireDeveloper(userId);
    if (!isValidObjectId(targetId))
      throw new NotFoundException('Account not found.');
    if (targetId === this.config.developerUserId)
      throw new ForbiddenException(
        'Developer access is configured on the server.',
      );
    const found = await this.users.findByIdAndUpdate(targetId, {
      $set: { cohort: dto.cohort, featureOverrides: dto.overrides },
    });
    if (!found) throw new NotFoundException('Account not found.');
    return { success: true };
  }
}
@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const module = this.reflector.getAllAndOverride<FeatureId>(REQUIRED_MODULE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!module) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { userId: string } }>();
    // Alternate credentials are checked at their verified-owner boundary instead.
    if (!request.user) return true;
    await this.access.require(request.user.userId, module);
    return true;
  }
}
@Controller('access/users')
class AccessController {
  constructor(private readonly access: AccessService) {}
  @Get('policies') policies(@CurrentUser('userId') userId: string) {
    return this.access.getPolicies(userId);
  }
  @Put('policies') policy(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateAccessDto,
  ) {
    return this.access.updatePolicy(userId, dto);
  }
  @Get() list(@CurrentUser('userId') userId: string) {
    return this.access.listUsers(userId);
  }
  @Put(':id') update(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccessDto,
  ) {
    return this.access.update(userId, id, dto);
  }
}
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: FeaturePolicy.name, schema: FeaturePolicySchema },
    ]),
  ],
  providers: [AccessService],
  exports: [AccessService],
  controllers: [AccessController],
})
export class AccessModule {}
