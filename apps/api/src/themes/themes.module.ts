import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { isValidObjectId, Schema as MongooseSchema, type Model } from 'mongoose';
import {
  THEME_NAME_MAX,
  THEME_PRESET_PREFIX,
  THEME_PRESETS,
  THEME_V0,
  THEME_V0_ID,
  THEME_V0_NAME,
  type ActiveTheme,
  type Theme,
  type ThemeList,
  type ThemeValues,
} from '@life-portal/shared-types';
import { completeValues, themeProblems, valuesProblem } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';

/** The most themes kept. An admin's list, not a feed; the cap keeps the list one small read. */
export const THEMES_MAX = 50;

/**
 * A colour theme (spec 037): a name and one colour per role for light and for dark. It belongs
 * to the app, not to an account, so there is no `userId`: the same reason Training's shared
 * catalogue cannot use `OwnedCrudService`. Only the developer account writes; every signed-in
 * device reads the active one. v0 is not a row: it is `THEME_V0` in code, so it cannot be
 * edited, deleted or lost.
 */
@Schema({ collection: 'themes', timestamps: true, versionKey: false })
export class ThemeRow {
  @Prop({ required: true }) name!: string;
  @Prop({ required: true, default: 1 }) version!: number;
  @Prop({ type: MongooseSchema.Types.Mixed, required: true }) light!: ThemeValues;
  @Prop({ type: MongooseSchema.Types.Mixed, required: true }) dark!: ThemeValues;
  updatedAt?: Date;
}
export const ThemeRowSchema = SchemaFactory.createForClass(ThemeRow);

/** One row (`key: 'active'`): which theme everyone sees. Absent: v0. */
@Schema({ collection: 'theme_settings', timestamps: true, versionKey: false })
export class ThemeSetting {
  @Prop({ required: true, unique: true }) key!: string;
  @Prop({ required: true }) themeId!: string;
}
export const ThemeSettingSchema = SchemaFactory.createForClass(ThemeSetting);

export class CreateThemeDto {
  @IsString() @MinLength(1) @MaxLength(THEME_NAME_MAX) name!: string;
  /** The theme to start from: an id, `v0` or `preset:<id>`. */
  @IsOptional() @IsString() @MaxLength(60) from?: string;
}

export class UpdateThemeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(THEME_NAME_MAX) name?: string;
  @IsOptional() @IsObject() light?: Record<string, unknown>;
  @IsOptional() @IsObject() dark?: Record<string, unknown>;
  /** The version this editor loaded; a stale one is refused with `STALE_EDIT`. */
  @IsInt() @Min(0) baseVersion!: number;
}

const V0: Theme = {
  id: THEME_V0_ID,
  name: THEME_V0_NAME,
  builtIn: true,
  version: 1,
  light: THEME_V0.light,
  dark: THEME_V0.dark,
  updatedAt: '2026-11-17T00:00:00.000Z',
};

type Row = ThemeRow & { _id: unknown };

@Injectable()
export class ThemesService {
  constructor(
    @InjectModel(ThemeRow.name) private readonly themes: Model<ThemeRow>,
    @InjectModel(ThemeSetting.name) private readonly settings: Model<ThemeSetting>,
    private readonly access: AccessService,
  ) {}

  /** Completed on the way out, so a theme saved before a role existed still has every role. */
  private toTheme(row: Row): Theme {
    return {
      id: String(row._id),
      name: row.name,
      builtIn: false,
      version: row.version ?? 1,
      light: completeValues(row.light, 'light'),
      dark: completeValues(row.dark, 'dark'),
      updatedAt: (row.updatedAt ?? new Date(0)).toISOString(),
    };
  }

  private async find(id: string): Promise<Theme> {
    if (id === THEME_V0_ID) return V0;
    if (id.startsWith(THEME_PRESET_PREFIX)) {
      const preset = THEME_PRESETS.find((item) => item.id === id.slice(THEME_PRESET_PREFIX.length));
      if (!preset) throw new NotFoundException('Theme not found.');
      return { ...V0, id, name: preset.name, light: completeValues(preset.light, 'light'), dark: completeValues(preset.dark, 'dark') };
    }
    const row = isValidObjectId(id) ? await this.themes.findById(id).lean<Row>() : null;
    if (!row) throw new NotFoundException('Theme not found.');
    return this.toTheme(row);
  }

  private async activeId(): Promise<string> {
    const setting = await this.settings.findOne({ key: 'active' }).lean();
    return setting?.themeId ?? THEME_V0_ID;
  }

  /**
   * For every signed-in device. Colours only. A deleted or unreadable active theme answers v0,
   * so the app always has a look.
   */
  async active(): Promise<ActiveTheme> {
    const id = await this.activeId();
    const theme = await this.find(id).catch(() => V0);
    return { id: theme.id, version: theme.version, light: theme.light, dark: theme.dark };
  }

  async list(userId: string): Promise<ThemeList> {
    this.access.requireDeveloper(userId);
    const [rows, activeId] = await Promise.all([
      this.themes.find().sort({ name: 1 }).limit(THEMES_MAX).lean<Row[]>(),
      this.activeId(),
    ]);
    return {
      activeId,
      themes: [V0, ...rows.map((row) => this.toTheme(row))],
      presets: THEME_PRESETS.map(({ id, name }) => ({ id, name })),
    };
  }

  /** A new theme is always a copy: of `from`, or of v0. */
  async create(userId: string, dto: CreateThemeDto): Promise<Theme> {
    this.access.requireDeveloper(userId);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('A theme needs a name.');
    if ((await this.themes.countDocuments()) >= THEMES_MAX)
      throw new ConflictException(`There can be at most ${THEMES_MAX} themes. Delete one first.`);
    const source = await this.find(dto.from ?? THEME_V0_ID);
    const row = await this.themes.create({ name, version: 1, light: source.light, dark: source.dark });
    return this.toTheme(row.toObject() as Row);
  }

  async update(userId: string, id: string, dto: UpdateThemeDto): Promise<Theme> {
    this.access.requireDeveloper(userId);
    if (id === THEME_V0_ID) throw new ConflictException({ code: 'THEME_BUILT_IN', message: 'v0 cannot be changed. Duplicate it instead.' });
    const current = await this.find(id);
    const set: Partial<Pick<ThemeRow, 'name' | 'light' | 'dark'>> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('A theme needs a name.');
      set.name = name;
    }
    for (const mode of ['light', 'dark'] as const) {
      const values = dto[mode];
      if (values === undefined) continue;
      const problem = valuesProblem(values);
      if (problem) throw new BadRequestException(problem);
      // Sent roles over the stored ones: an editor may send only what changed.
      set[mode] = completeValues({ ...current[mode], ...(values as ThemeValues) }, mode);
    }
    // The theme everyone is looking at stays readable: the same check as activating it.
    if ((set.light || set.dark) && (await this.activeId()) === id) {
      const problems = themeProblems({ light: set.light ?? current.light, dark: set.dark ?? current.dark });
      if (problems.length)
        throw new UnprocessableEntityException({
          code: 'THEME_UNREADABLE',
          message: 'This theme is active, and these colours would make text hard to read.',
          problems,
        });
    }
    // Missing `version` is 1 (`toTheme`), so match what the editor was shown.
    const versionFilter = dto.baseVersion === 1 ? { $or: [{ version: 1 }, { version: { $exists: false } }] } : { version: dto.baseVersion };
    const row = await this.themes
      .findOneAndUpdate({ _id: id, ...versionFilter }, { $set: { ...set, version: dto.baseVersion + 1 } }, { new: true })
      .lean<Row>();
    if (!row)
      throw new ConflictException({
        code: 'STALE_EDIT',
        message: 'This theme was changed somewhere else. Reload it before saving.',
        current: await this.find(id),
      });
    return this.toTheme(row);
  }

  async remove(userId: string, id: string): Promise<{ success: true }> {
    this.access.requireDeveloper(userId);
    if (id === THEME_V0_ID) throw new ConflictException({ code: 'THEME_BUILT_IN', message: 'v0 cannot be deleted.' });
    if ((await this.activeId()) === id)
      throw new ConflictException({ code: 'THEME_ACTIVE', message: 'This theme is active. Activate another one first.' });
    // Deleting what is already gone succeeds.
    if (isValidObjectId(id)) await this.themes.deleteOne({ _id: id });
    return { success: true };
  }

  /** Makes a theme the one everyone sees. Refused while it fails a readability check. */
  async activate(userId: string, id: string): Promise<ThemeList> {
    this.access.requireDeveloper(userId);
    if (id.startsWith(THEME_PRESET_PREFIX)) throw new NotFoundException('Theme not found.');
    const theme = await this.find(id);
    const problems = themeProblems(theme);
    if (problems.length)
      throw new UnprocessableEntityException({
        code: 'THEME_UNREADABLE',
        message: 'This theme has colours that make text hard to read. Fix them before activating it.',
        problems,
      });
    await this.settings.findOneAndUpdate({ key: 'active' }, { $set: { themeId: theme.id } }, { upsert: true });
    return this.list(userId);
  }
}

@Controller('themes')
export class ThemesController {
  constructor(private readonly themes: ThemesService) {}

  /** Every signed-in device. Not `@Public()`: sign-in screens use the kept theme or v0. */
  @Get('active') @Header('Cache-Control', 'no-store') active() {
    return this.themes.active();
  }
  @Get() list(@CurrentUser('userId') userId: string) {
    return this.themes.list(userId);
  }
  @Post() create(@CurrentUser('userId') userId: string, @Body() dto: CreateThemeDto) {
    return this.themes.create(userId, dto);
  }
  @Patch(':id') update(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: UpdateThemeDto) {
    return this.themes.update(userId, id, dto);
  }
  @Delete(':id') remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.themes.remove(userId, id);
  }
  @Post(':id/activate') activate(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.themes.activate(userId, id);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ThemeRow.name, schema: ThemeRowSchema },
      { name: ThemeSetting.name, schema: ThemeSettingSchema },
    ]),
  ],
  controllers: [ThemesController],
  providers: [ThemesService],
})
export class ThemesModule {}
