import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { IsBoolean, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { isValidObjectId, type Model } from 'mongoose';
import {
  BRAND_EXISTS,
  BRAND_NAME_MAX,
  OWN_BRANDS_MAX,
  STARTER_BRANDS,
  type FoodBrand,
} from '@life-portal/shared-types';
import { brandKey, cleanBrandName } from '@life-portal/shared-domain';
import { AccessService, RequireModule } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { MediaService } from '../media/media.service';
import { Food } from './nutrition.schemas';

/**
 * A food brand: a name and an optional logo. A row with no `userId` is public (everyone sees
 * it); a row with one is that person's own. Like Training's shared catalogue, the public rows
 * are why this cannot use `OwnedCrudService`: every query here says which of the two it means.
 *
 * Foods are joined to a brand by `key` (`brandKey(name)`), not by an id, so a food saved before
 * brands existed, or copied from someone else, finds its brand by its name alone.
 */
@Schema({ collection: 'food_brands', timestamps: true, versionKey: false })
export class FoodBrandRow {
  /** Absent: a public brand. */
  @Prop() userId?: string;
  @Prop({ required: true, maxlength: BRAND_NAME_MAX }) name!: string;
  @Prop({ required: true }) key!: string;
  @Prop({ type: Object }) logo?: { key: string; width: number; height: number };
}
export const FoodBrandSchema = SchemaFactory.createForClass(FoodBrandRow);
// One brand per name for a person, and one per name among the public ones (`userId` absent).
FoodBrandSchema.index({ userId: 1, key: 1 }, { unique: true });

export class CreateBrandDto {
  @IsString() @MinLength(1) @MaxLength(BRAND_NAME_MAX) name!: string;
  @IsOptional() @IsMongoId() imageMediaId?: string;
  /** Developer only: create it as a public brand. */
  @IsOptional() @IsBoolean() public?: boolean;
}

export class UpdateBrandDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(BRAND_NAME_MAX) name?: string;
  @IsOptional() @IsMongoId() imageMediaId?: string;
  @IsOptional() @IsBoolean() removeImage?: boolean;
}

type Row = FoodBrandRow & { _id: unknown };
const PUBLIC = { userId: { $exists: false } };

@Injectable()
export class BrandsService {
  private seeded?: Promise<void>;

  constructor(
    @InjectModel(FoodBrandRow.name) private readonly brands: Model<FoodBrandRow>,
    @InjectModel(Food.name) private readonly foods: Model<Food>,
    private readonly media: MediaService,
    private readonly access: AccessService,
  ) {}

  /** The starter public brands, once per process. Names only; never overwrites an existing row. */
  private ensureStarters(): Promise<void> {
    this.seeded ??= this.brands
      .bulkWrite(
        STARTER_BRANDS.map((name) => ({
          updateOne: {
            filter: { ...PUBLIC, key: brandKey(name) },
            update: { $setOnInsert: { name, key: brandKey(name) } },
            upsert: true,
          },
        })),
        { ordered: false },
      )
      .then(() => undefined)
      // A failed seed must not take the brand list down with it; it is tried again next start.
      .catch(() => undefined);
    return this.seeded;
  }

  private async dto(row: Row): Promise<FoodBrand> {
    const logoUrl = row.logo ? await this.media.signKey(row.logo.key) : undefined;
    return {
      id: String(row._id),
      name: row.name,
      key: row.key,
      scope: row.userId ? 'own' : 'public',
      ...(logoUrl ? { logoUrl } : {}),
    };
  }

  /** Every public brand and the person's own, by name. Their own wins a shared name. */
  async list(userId: string): Promise<FoodBrand[]> {
    await this.ensureStarters();
    const rows = await this.brands
      .find({ $or: [PUBLIC, { userId }] })
      .sort({ name: 1 })
      .limit(1000)
      .lean<Row[]>();
    const own = new Set(rows.filter((row) => row.userId).map((row) => row.key));
    return Promise.all(rows.filter((row) => row.userId || !own.has(row.key)).map((row) => this.dto(row)));
  }

  private async find(userId: string, key: string): Promise<Row | null> {
    const rows = await this.brands.find({ key, $or: [PUBLIC, { userId }] }).lean<Row[]>();
    return rows.find((row) => row.userId) ?? rows[0] ?? null;
  }

  /**
   * The brand name a food is saved with. Text that is an existing brand in any spelling becomes
   * that brand's own name; text that is new becomes the person's own brand. So no two spellings
   * of one brand are ever stored, and typing a brand is all it takes to create it. Never throws
   * for a food's sake: at the cap, or on a race, the cleaned text is used as it is.
   */
  async resolve(userId: string, text: string | undefined | null): Promise<string | undefined> {
    const name = cleanBrandName(text).slice(0, BRAND_NAME_MAX);
    const key = brandKey(name);
    if (!key) return undefined;
    await this.ensureStarters();
    const existing = await this.find(userId, key);
    if (existing) return existing.name;
    if ((await this.brands.countDocuments({ userId })) >= OWN_BRANDS_MAX) return name;
    await this.brands.create({ userId, name, key }).catch(() => undefined);
    return name;
  }

  private async mine(userId: string, id: string): Promise<Row> {
    const row = isValidObjectId(id) ? await this.brands.findById(id).lean<Row>() : null;
    // A public brand is the developer's to change; anyone else's own brand does not exist here.
    if (!row || (row.userId ? row.userId !== userId : !this.isDeveloper(userId)))
      throw new NotFoundException('Brand not found.');
    return row;
  }

  private isDeveloper(userId: string): boolean {
    try {
      this.access.requireDeveloper(userId);
      return true;
    } catch {
      return false;
    }
  }

  private exists(existing: Row): ConflictException {
    return new ConflictException({
      code: BRAND_EXISTS,
      message: `"${existing.name}" already exists. Choose it instead.`,
      existing: { id: String(existing._id), name: existing.name, scope: existing.userId ? 'own' : 'public' },
    });
  }

  async create(userId: string, dto: CreateBrandDto): Promise<FoodBrand> {
    const name = cleanBrandName(dto.name);
    const key = brandKey(name);
    if (!key) throw new BadRequestException('A brand needs a name with letters or numbers.');
    if (dto.public) this.access.requireDeveloper(userId);
    await this.ensureStarters();
    const existing = await this.find(userId, key);
    if (existing) throw this.exists(existing);
    if (!dto.public && (await this.brands.countDocuments({ userId })) >= OWN_BRANDS_MAX)
      throw new ConflictException(`You can have at most ${OWN_BRANDS_MAX} brands of your own.`);
    const created = await this.brands.create({ ...(dto.public ? {} : { userId }), name, key });
    const id = String(created._id);
    if (!dto.imageMediaId) return this.dto(created.toObject() as Row);
    const logo = await this.media.copyForBrand(userId, dto.imageMediaId, id);
    await this.brands.updateOne({ _id: id }, { $set: { logo } });
    return this.dto({ ...(created.toObject() as Row), logo });
  }

  async update(userId: string, id: string, dto: UpdateBrandDto): Promise<FoodBrand> {
    const row = await this.mine(userId, id);
    await this.ensureStarters();
    const oldName = row.name;
    const oldLogo = row.logo?.key;
    const set: Record<string, unknown> = {};
    let renamedTo: string | undefined;
    if (dto.name !== undefined) {
      const name = cleanBrandName(dto.name);
      const key = brandKey(name);
      if (!key) throw new BadRequestException('A brand needs a name with letters or numbers.');
      if (key !== row.key) {
        const clash = await this.brands.findOne({ key, ...(row.userId ? { $or: [PUBLIC, { userId }] } : PUBLIC) }).lean<Row>();
        if (clash) throw this.exists(clash);
      }
      if (name !== row.name) {
        set['name'] = name;
        set['key'] = key;
        renamedTo = name;
      }
    }
    if (dto.imageMediaId) set['logo'] = await this.media.copyForBrand(userId, dto.imageMediaId, id);
    const unset = !dto.imageMediaId && dto.removeImage && row.logo ? { logo: '' } : undefined;
    if (!Object.keys(set).length && !unset) return this.dto(row);
    const updated = await this.brands
      .findOneAndUpdate({ _id: id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(unset ? { $unset: unset } : {}) }, { new: true })
      .lean<Row>();
    if (!updated) throw new NotFoundException('Brand not found.');
    if (oldLogo && (dto.imageMediaId || unset)) void this.media.deleteKey(oldLogo);
    // A food carries its brand's name, so a renamed brand takes its foods with it: the owner's
    // for their own brand, everyone's for a public one.
    if (renamedTo) await this.foods.updateMany({ ...(row.userId ? { userId } : {}), brand: oldName }, { $set: { brand: renamedTo } });
    return this.dto(updated);
  }

  /** Removes the brand and its logo. Foods keep the name as plain text. */
  async remove(userId: string, id: string): Promise<{ success: true }> {
    const row = await this.mine(userId, id);
    await this.brands.deleteOne({ _id: id });
    void this.media.deleteKey(row.logo?.key);
    return { success: true };
  }

  /** Developer only: one of the developer's own brands becomes a public one, logo included. */
  async publish(userId: string, id: string): Promise<FoodBrand> {
    this.access.requireDeveloper(userId);
    const row = await this.mine(userId, id);
    if (!row.userId) return this.dto(row);
    const clash = await this.brands.findOne({ ...PUBLIC, key: row.key }).lean<Row>();
    if (clash) throw this.exists(clash);
    const updated = await this.brands.findOneAndUpdate({ _id: id }, { $unset: { userId: '' } }, { new: true }).lean<Row>();
    if (!updated) throw new NotFoundException('Brand not found.');
    return this.dto(updated);
  }
}

@RequireModule('nutrition')
@Controller('nutrition/brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  // Signed logo links expire, so the list is never stored by anything in between.
  @Get() @Header('Cache-Control', 'no-store') list(@CurrentUser('userId') userId: string) {
    return this.brands.list(userId);
  }
  @Post() create(@CurrentUser('userId') userId: string, @Body() dto: CreateBrandDto) {
    return this.brands.create(userId, dto);
  }
  @Patch(':id') update(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.brands.update(userId, id, dto);
  }
  @Delete(':id') remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.brands.remove(userId, id);
  }
  @Post(':id/publish') publish(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.brands.publish(userId, id);
  }
}
