import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Today } from '../common/today';
import {
  CreateBoardDto,
  CreateContributionDto,
  CreateNoteDto,
  CreatePersonDto,
  CreateTaskDto,
  CreateWinDto,
  ReorderDto,
  UpdateBoardDto,
  UpdateContributionDto,
  UpdateNoteDto,
  UpdatePersonDto,
  UpdateTaskDto,
  UpdateWinDto,
} from './boards.dto';
import {
  Board,
  BoardNote,
  BoardNoteSchema,
  BoardSchema,
  BoardTask,
  BoardTaskSchema,
  Contribution,
  ContributionSchema,
  Person,
  PersonSchema,
  Win,
  WinSchema,
} from './boards.schemas';
import { BoardsService } from './boards.service';

export class LogOneOnOneDto {
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  async list(@CurrentUser('userId') userId: string, @Today() today: string) {
    const [boards, summaries] = await Promise.all([
      this.boards.list(userId),
      this.boards.summaries(userId, today),
    ]);
    return { boards, summaries };
  }

  @Post()
  createBoard(@CurrentUser('userId') userId: string, @Body() dto: CreateBoardDto) {
    return this.boards.createBoard(userId, dto);
  }

  /** `key` accepts a slug (`epam`) or a Mongo id. */
  @Get(':key')
  detail(@CurrentUser('userId') userId: string, @Param('key') key: string, @Today() today: string) {
    return this.boards.detail(userId, key, today);
  }

  @Patch(':key')
  updateBoard(@CurrentUser('userId') userId: string, @Param('key') key: string, @Body() dto: UpdateBoardDto) {
    return this.boards.updateBoard(userId, key, dto);
  }

  @Delete(':key')
  removeBoard(@CurrentUser('userId') userId: string, @Param('key') key: string) {
    return this.boards.removeBoard(userId, key);
  }

  // ------------------------------------------------------------ tasks

  @Get(':key/tasks')
  async listTasks(
    @CurrentUser('userId') userId: string,
    @Param('key') key: string,
    @Query('status') status?: string,
  ) {
    const board = await this.boards.resolve(userId, key);
    return this.boards.listTasks(userId, board.id, status);
  }

  @Post(':key/tasks')
  async createTask(@CurrentUser('userId') userId: string, @Param('key') key: string, @Body() dto: CreateTaskDto) {
    const board = await this.boards.resolve(userId, key);
    return this.boards.createTask(userId, board.id, dto);
  }

  @Put(':key/tasks/order')
  async reorderTasks(@CurrentUser('userId') userId: string, @Param('key') key: string, @Body() dto: ReorderDto) {
    const board = await this.boards.resolve(userId, key);
    return this.boards.reorderTasks(userId, board.id, dto.order);
  }

  @Patch('tasks/:id')
  updateTask(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @Today() today: string,
  ) {
    return this.boards.updateTask(userId, id, dto, today);
  }

  @Delete('tasks/:id')
  removeTask(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.boards.removeTask(userId, id);
  }

  // ------------------------------------------------------------ notes

  @Post(':key/notes')
  async createNote(@CurrentUser('userId') userId: string, @Param('key') key: string, @Body() dto: CreateNoteDto) {
    const board = await this.boards.resolve(userId, key);
    return this.boards.createNote(userId, board.id, dto);
  }

  @Patch('notes/:id')
  updateNote(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: UpdateNoteDto) {
    return this.boards.updateNote(userId, id, dto);
  }

  @Delete('notes/:id')
  removeNote(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.boards.removeNote(userId, id);
  }

  // ------------------------------------------------------------ people

  @Post(':key/people')
  async createPerson(@CurrentUser('userId') userId: string, @Param('key') key: string, @Body() dto: CreatePersonDto) {
    const board = await this.boards.resolve(userId, key);
    return this.boards.createPerson(userId, board.id, dto);
  }

  @Patch('people/:id')
  updatePerson(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: UpdatePersonDto) {
    return this.boards.updatePerson(userId, id, dto);
  }

  @Post('people/:id/one-on-one')
  logOneOnOne(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: LogOneOnOneDto,
    @Today() today: string,
  ) {
    return this.boards.logOneOnOne(userId, id, today, dto.note);
  }

  @Delete('people/:id')
  removePerson(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.boards.removePerson(userId, id);
  }

  // ------------------------------------------------------------ contributions

  @Post(':key/contributions')
  async createContribution(
    @CurrentUser('userId') userId: string,
    @Param('key') key: string,
    @Body() dto: CreateContributionDto,
    @Today() today: string,
  ) {
    const board = await this.boards.resolve(userId, key);
    return this.boards.createContribution(userId, board.id, dto, today);
  }

  @Patch('contributions/:id')
  updateContribution(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContributionDto,
  ) {
    return this.boards.updateContribution(userId, id, dto);
  }

  @Delete('contributions/:id')
  removeContribution(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.boards.removeContribution(userId, id);
  }

  // ------------------------------------------------------------ wins

  @Post(':key/wins')
  async createWin(
    @CurrentUser('userId') userId: string,
    @Param('key') key: string,
    @Body() dto: CreateWinDto,
    @Today() today: string,
  ) {
    const board = await this.boards.resolve(userId, key);
    return this.boards.createWin(userId, board.id, dto, today);
  }

  @Patch('wins/:id')
  updateWin(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: UpdateWinDto) {
    return this.boards.updateWin(userId, id, dto);
  }

  @Delete('wins/:id')
  removeWin(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.boards.removeWin(userId, id);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Board.name, schema: BoardSchema },
      { name: BoardTask.name, schema: BoardTaskSchema },
      { name: BoardNote.name, schema: BoardNoteSchema },
      { name: Person.name, schema: PersonSchema },
      { name: Contribution.name, schema: ContributionSchema },
      { name: Win.name, schema: WinSchema },
    ]),
  ],
  controllers: [BoardsController],
  providers: [BoardsService],
  exports: [BoardsService],
})
export class BoardsModule {}
