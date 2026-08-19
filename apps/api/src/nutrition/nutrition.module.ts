import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CurrentUser } from '../auth/current-user.decorator';
import { Today } from '../common/today';
import {
  CreateCheatMealDto,
  CreateEntryDto,
  CreateFoodDto,
  CreateSavedMealDto,
  ImportFoodDto,
  LogSavedMealDto,
  RepeatMealDto,
  ReorderCheatDto,
  SaveSlotAsMealDto,
  UpdateCheatMealDto,
  UpdateEntryDto,
  UpdateFoodDto,
  UpdateProfileDto,
  UpdateSavedMealDto,
  UpsertWeighInDto,
} from './nutrition.dto';
import {
  CheatMeal,
  CheatMealSchema,
  Food,
  FoodSchema,
  MealEntry,
  MealEntrySchema,
  NutritionProfile,
  NutritionProfileSchema,
  SavedMeal,
  SavedMealSchema,
  WeighIn,
  WeighInSchema,
} from './nutrition.schemas';
import { NutritionService } from './nutrition.service';
import { OpenFoodFactsProvider } from './openfoodfacts.provider';

@Controller('nutrition')
export class NutritionController {
  constructor(private readonly nutrition: NutritionService) {}

  /**
   * Everything the detail page needs in one round trip.
   *
   * `day` is the day being *viewed*, which may not be today — the page has a day navigator so a
   * missed evening can be filled in. `today` still governs the targets, the week and the
   * countdown, and arrives from the browser's clock via `?today=` (see `resolveToday`).
   */
  @Get()
  overview(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Query('day') day?: string,
  ) {
    return this.nutrition.overview(userId, today, day);
  }

  @Get('summary')
  summary(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.nutrition.summary(userId, today);
  }

  // ---------------------------------------------------------------- foods

  @Get('foods')
  listFoods(
    @CurrentUser('userId') userId: string,
    @Query('q') q?: string,
    @Query('favourite') favourite?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.nutrition.listFoods(userId, {
      q,
      favourite: favourite === 'true',
      includeArchived: includeArchived === 'true',
    });
  }

  /** Open Food Facts search. Declared before `foods/:id` so the literal path wins the route. */
  @Get('foods/lookup')
  lookup(@Query('q') q?: string) {
    return this.nutrition.searchLookup(q ?? '');
  }

  @Get('foods/lookup/barcode/:code')
  lookupBarcode(@Param('code') code: string) {
    return this.nutrition.barcodeLookup(code);
  }

  @Post('foods/import')
  importFood(@CurrentUser('userId') userId: string, @Body() dto: ImportFoodDto) {
    return this.nutrition.importFood(userId, dto.code);
  }

  @Post('foods')
  createFood(@CurrentUser('userId') userId: string, @Body() dto: CreateFoodDto) {
    return this.nutrition.createFood(userId, dto);
  }

  @Patch('foods/:id')
  updateFood(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFoodDto,
  ) {
    return this.nutrition.updateFood(userId, id, dto);
  }

  @Delete('foods/:id')
  removeFood(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.nutrition.removeFood(userId, id);
  }

  // ---------------------------------------------------------------- entries

  @Get('entries')
  listEntries(
    @CurrentUser('userId') userId: string,
    @Query('day') day?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.nutrition.listEntries(userId, { day, from, to });
  }

  @Post('entries')
  createEntry(@CurrentUser('userId') userId: string, @Body() dto: CreateEntryDto) {
    return this.nutrition.createEntry(userId, dto);
  }

  @Post('entries/repeat')
  repeatMeal(@CurrentUser('userId') userId: string, @Body() dto: RepeatMealDto) {
    return this.nutrition.repeatMeal(userId, dto);
  }

  @Patch('entries/:id')
  updateEntry(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEntryDto,
  ) {
    return this.nutrition.updateEntry(userId, id, dto);
  }

  @Delete('entries/:id')
  removeEntry(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.nutrition.removeEntry(userId, id);
  }

  // ---------------------------------------------------------------- saved meals

  @Get('meals')
  listMeals(@CurrentUser('userId') userId: string) {
    return this.nutrition.listSavedMeals(userId);
  }

  @Post('meals')
  createMeal(@CurrentUser('userId') userId: string, @Body() dto: CreateSavedMealDto) {
    return this.nutrition.createSavedMeal(userId, dto);
  }

  @Post('meals/from-day')
  saveSlotAsMeal(@CurrentUser('userId') userId: string, @Body() dto: SaveSlotAsMealDto) {
    return this.nutrition.saveSlotAsMeal(userId, dto);
  }

  @Patch('meals/:id')
  updateMeal(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSavedMealDto,
  ) {
    return this.nutrition.updateSavedMeal(userId, id, dto);
  }

  @Delete('meals/:id')
  removeMeal(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.nutrition.removeSavedMeal(userId, id);
  }

  @Post('meals/:id/log')
  logMeal(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: LogSavedMealDto,
  ) {
    return this.nutrition.logSavedMeal(userId, id, dto);
  }

  // ---------------------------------------------------------------- profile

  @Get('profile')
  async profile(@CurrentUser('userId') userId: string, @Today() today: string) {
    const [profile, targets] = await Promise.all([
      this.nutrition.profile(userId),
      this.nutrition.targets(userId, today),
    ]);
    return { profile, targets };
  }

  @Put('profile')
  async updateProfile(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const profile = await this.nutrition.updateProfile(userId, dto);
    // The new targets ship with the write, so the settings panel shows them without a refetch.
    return { profile, targets: await this.nutrition.targets(userId, today) };
  }

  @Get('weigh-ins')
  listWeighIns(@CurrentUser('userId') userId: string) {
    return this.nutrition.listWeighIns(userId);
  }

  @Put('weigh-ins')
  upsertWeighIn(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Body() dto: UpsertWeighInDto,
  ) {
    return this.nutrition.upsertWeighIn(userId, today, dto);
  }

  @Delete('weigh-ins/:id')
  removeWeighIn(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.nutrition.removeWeighIn(userId, id);
  }

  // ---------------------------------------------------------------- cheat day

  @Get('cheat')
  cheat(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.nutrition.cheatInfo(userId, today);
  }

  @Post('cheat')
  createCheat(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Body() dto: CreateCheatMealDto,
  ) {
    return this.nutrition.createCheatMeal(userId, today, dto);
  }

  /** The full id array, as `POST /api/boards/:key/tasks/order` takes. */
  @Post('cheat/order')
  reorderCheat(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Body() dto: ReorderCheatDto,
  ) {
    return this.nutrition.reorderCheatMeals(userId, today, dto.order);
  }

  @Patch('cheat/:id')
  updateCheat(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Today() today: string,
    @Body() dto: UpdateCheatMealDto,
  ) {
    return this.nutrition.updateCheatMeal(userId, id, today, dto);
  }

  @Delete('cheat/:id')
  removeCheat(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.nutrition.removeCheatMeal(userId, id);
  }

  @Post('cheat/:id/log')
  logCheat(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: LogSavedMealDto,
  ) {
    return this.nutrition.logCheatMeal(userId, id, dto);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Food.name, schema: FoodSchema },
      { name: MealEntry.name, schema: MealEntrySchema },
      { name: SavedMeal.name, schema: SavedMealSchema },
      { name: NutritionProfile.name, schema: NutritionProfileSchema },
      { name: WeighIn.name, schema: WeighInSchema },
      { name: CheatMeal.name, schema: CheatMealSchema },
    ]),
  ],
  controllers: [NutritionController],
  providers: [NutritionService, OpenFoodFactsProvider],
  exports: [NutritionService],
})
export class NutritionModule {}
