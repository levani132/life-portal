import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import type {
  Board as BoardDto,
  BoardNote as BoardNoteDto,
  BoardSummary,
  BoardTask as BoardTaskDto,
  Contribution as ContributionDto,
  Person as PersonDto,
  Priority,
  Win as WinDto,
} from '@life-portal/shared-types';
import { CONTRIBUTION_POINTS, type ContributionType } from '@life-portal/shared-types';
import { addDays, addMonths, isAfter, minDay, toDay } from '@life-portal/shared-domain';
import { Board, BoardNote, BoardTask, Contribution, Person, Win } from './boards.schemas';
import type {
  CreateBoardDto,
  CreateContributionDto,
  CreateNoteDto,
  CreatePersonDto,
  CreateTaskDto,
  CreateWinDto,
  UpdateBoardDto,
  UpdateContributionDto,
  UpdateNoteDto,
  UpdatePersonDto,
  UpdateTaskDto,
  UpdateWinDto,
} from './boards.dto';

const OPEN_STATUSES = ['todo', 'in_progress', 'blocked'];
/** Promotion progress is judged on a rolling six months, matching EPAM's review cadence. */
const CONTRIBUTION_WINDOW_MONTHS = 6;

@Injectable()
export class BoardsService {
  constructor(
    @InjectModel(Board.name) private readonly boards: Model<Board>,
    @InjectModel(BoardTask.name) private readonly tasks: Model<BoardTask>,
    @InjectModel(BoardNote.name) private readonly notes: Model<BoardNote>,
    @InjectModel(Person.name) private readonly people: Model<Person>,
    @InjectModel(Contribution.name) private readonly contributions: Model<Contribution>,
    @InjectModel(Win.name) private readonly wins: Model<Win>,
  ) {}

  // ---------------------------------------------------------------- boards

  async list(userId: string): Promise<BoardDto[]> {
    const rows = await this.boards.find({ userId, archived: false }).sort({ order: 1, name: 1 });
    return rows.map((r) => r.toJSON() as unknown as BoardDto);
  }

  /** Accepts either a Mongo id or the board's slug, so URLs can read `/boards/epam`. */
  async resolve(userId: string, idOrKey: string): Promise<BoardDto> {
    const found = await this.boards.findOne({
      userId,
      ...(isValidObjectId(idOrKey) ? { _id: idOrKey } : { key: idOrKey.toLowerCase() }),
    });
    if (!found) throw new NotFoundException(`Board ${idOrKey} not found`);
    return found.toJSON() as unknown as BoardDto;
  }

  async createBoard(userId: string, dto: CreateBoardDto): Promise<BoardDto> {
    const created = await this.boards.create({ ...dto, userId });
    return created.toJSON() as unknown as BoardDto;
  }

  async updateBoard(userId: string, idOrKey: string, dto: UpdateBoardDto): Promise<BoardDto> {
    const board = await this.resolve(userId, idOrKey);
    const updated = await this.boards.findOneAndUpdate({ _id: board.id, userId }, { $set: dto }, { new: true });
    // `resolve` just found it, so this only fires on a concurrent delete.
    if (!updated) throw new NotFoundException(`Board ${idOrKey} not found`);
    return updated.toJSON() as unknown as BoardDto;
  }

  /** Removing a board removes everything filed under it. */
  async removeBoard(userId: string, idOrKey: string) {
    const board = await this.resolve(userId, idOrKey);
    await Promise.all([
      this.tasks.deleteMany({ userId, boardId: board.id }),
      this.notes.deleteMany({ userId, boardId: board.id }),
      this.people.deleteMany({ userId, boardId: board.id }),
      this.contributions.deleteMany({ userId, boardId: board.id }),
      this.wins.deleteMany({ userId, boardId: board.id }),
      this.boards.deleteOne({ _id: board.id, userId }),
    ]);
    return { id: board.id, deleted: true as const };
  }

  // ---------------------------------------------------------------- tasks

  async listTasks(userId: string, boardId: string, status?: string): Promise<BoardTaskDto[]> {
    const rows = await this.tasks
      .find({ userId, boardId, ...(status ? { status } : {}) })
      .sort({ status: 1, priority: 1, order: 1, dueDate: 1 });
    return rows.map((r) => r.toJSON() as unknown as BoardTaskDto);
  }

  async createTask(userId: string, boardId: string, dto: CreateTaskDto): Promise<BoardTaskDto> {
    const created = await this.tasks.create({ ...dto, userId, boardId });
    return created.toJSON() as unknown as BoardTaskDto;
  }

  async updateTask(userId: string, id: string, dto: UpdateTaskDto, today: string): Promise<BoardTaskDto> {
    const patch: Record<string, unknown> = { ...dto };
    // Completion is stamped by the server so a task's history cannot drift from its status.
    if (dto.status === 'done') patch['completedAt'] = today;
    if (dto.status && dto.status !== 'done') patch['completedAt'] = undefined;

    const updated = await this.tasks.findOneAndUpdate(
      { _id: this.oid(id, 'Task'), userId },
      { $set: patch },
      { new: true },
    );
    if (!updated) throw new NotFoundException(`Task ${id} not found`);
    return updated.toJSON() as unknown as BoardTaskDto;
  }

  async removeTask(userId: string, id: string) {
    const deleted = await this.tasks.findOneAndDelete({ _id: this.oid(id, 'Task'), userId });
    if (!deleted) throw new NotFoundException(`Task ${id} not found`);
    return { id, deleted: true as const };
  }

  async reorderTasks(userId: string, boardId: string, order: string[]): Promise<BoardTaskDto[]> {
    await Promise.all(
      order.map((taskId, index) =>
        isValidObjectId(taskId)
          ? this.tasks.updateOne({ _id: taskId, userId, boardId }, { $set: { order: index } })
          : Promise.resolve(),
      ),
    );
    return this.listTasks(userId, boardId);
  }

  // ---------------------------------------------------------------- notes

  async listNotes(userId: string, boardId: string): Promise<BoardNoteDto[]> {
    const rows = await this.notes.find({ userId, boardId }).sort({ pinned: -1, updatedAt: -1 });
    return rows.map((r) => r.toJSON() as unknown as BoardNoteDto);
  }

  async createNote(userId: string, boardId: string, dto: CreateNoteDto): Promise<BoardNoteDto> {
    const created = await this.notes.create({ ...dto, userId, boardId });
    return created.toJSON() as unknown as BoardNoteDto;
  }

  async updateNote(userId: string, id: string, dto: UpdateNoteDto): Promise<BoardNoteDto> {
    const updated = await this.notes.findOneAndUpdate({ _id: this.oid(id, 'Note'), userId }, { $set: dto }, { new: true });
    if (!updated) throw new NotFoundException(`Note ${id} not found`);
    return updated.toJSON() as unknown as BoardNoteDto;
  }

  async removeNote(userId: string, id: string) {
    const deleted = await this.notes.findOneAndDelete({ _id: this.oid(id, 'Note'), userId });
    if (!deleted) throw new NotFoundException(`Note ${id} not found`);
    return { id, deleted: true as const };
  }

  // ---------------------------------------------------------------- people

  async listPeople(userId: string, boardId: string): Promise<PersonDto[]> {
    const rows = await this.people.find({ userId, boardId, archived: false }).sort({ attentionState: 1, name: 1 });
    return rows.map((r) => r.toJSON() as unknown as PersonDto);
  }

  async createPerson(userId: string, boardId: string, dto: CreatePersonDto): Promise<PersonDto> {
    const created = await this.people.create({ ...dto, userId, boardId });
    return created.toJSON() as unknown as PersonDto;
  }

  async updatePerson(userId: string, id: string, dto: UpdatePersonDto): Promise<PersonDto> {
    const updated = await this.people.findOneAndUpdate({ _id: this.oid(id, 'Person'), userId }, { $set: dto }, { new: true });
    if (!updated) throw new NotFoundException(`Person ${id} not found`);
    return updated.toJSON() as unknown as PersonDto;
  }

  async removePerson(userId: string, id: string) {
    const deleted = await this.people.findOneAndDelete({ _id: this.oid(id, 'Person'), userId });
    if (!deleted) throw new NotFoundException(`Person ${id} not found`);
    return { id, deleted: true as const };
  }

  /** Records a 1:1 and moves the next one out by the person's cadence. */
  async logOneOnOne(userId: string, id: string, today: string, note?: string): Promise<PersonDto> {
    const person = await this.people.findOne({ _id: this.oid(id, 'Person'), userId });
    if (!person) throw new NotFoundException(`Person ${id} not found`);

    person.lastOneOnOne = today;
    person.nextCheckIn = addDays(today, person.oneOnOneCadenceDays ?? 14);
    if (note) person.notes = `${today}: ${note}\n\n${person.notes ?? ''}`.trim();
    await person.save();
    return person.toJSON() as unknown as PersonDto;
  }

  /** A 1:1 is overdue when the cadence has elapsed since the last one. */
  isOneOnOneOverdue(person: PersonDto, today: string): boolean {
    if (!person.oneOnOneCadenceDays) return false;
    if (!person.lastOneOnOne) return true;
    return isAfter(today, addDays(person.lastOneOnOne, person.oneOnOneCadenceDays));
  }

  // ---------------------------------------------------------------- contributions

  async listContributions(userId: string, boardId: string): Promise<ContributionDto[]> {
    const rows = await this.contributions.find({ userId, boardId }).sort({ date: -1 });
    return rows.map((r) => r.toJSON() as unknown as ContributionDto);
  }

  async createContribution(
    userId: string,
    boardId: string,
    dto: CreateContributionDto,
    today: string,
  ): Promise<ContributionDto> {
    const created = await this.contributions.create({
      ...dto,
      userId,
      boardId,
      date: dto.date ?? today,
      // Default weight comes from the type, so the user never has to invent a number.
      points: dto.points ?? CONTRIBUTION_POINTS[dto.type as ContributionType] ?? 1,
    });
    return created.toJSON() as unknown as ContributionDto;
  }

  async updateContribution(userId: string, id: string, dto: UpdateContributionDto): Promise<ContributionDto> {
    const updated = await this.contributions.findOneAndUpdate(
      { _id: this.oid(id, 'Contribution'), userId },
      { $set: dto },
      { new: true },
    );
    if (!updated) throw new NotFoundException(`Contribution ${id} not found`);
    return updated.toJSON() as unknown as ContributionDto;
  }

  async removeContribution(userId: string, id: string) {
    const deleted = await this.contributions.findOneAndDelete({ _id: this.oid(id, 'Contribution'), userId });
    if (!deleted) throw new NotFoundException(`Contribution ${id} not found`);
    return { id, deleted: true as const };
  }

  // ---------------------------------------------------------------- wins

  async listWins(userId: string, boardId: string): Promise<WinDto[]> {
    const rows = await this.wins.find({ userId, boardId }).sort({ date: -1 });
    return rows.map((r) => r.toJSON() as unknown as WinDto);
  }

  async createWin(userId: string, boardId: string, dto: CreateWinDto, today: string): Promise<WinDto> {
    const created = await this.wins.create({ ...dto, userId, boardId, date: dto.date ?? today });
    return created.toJSON() as unknown as WinDto;
  }

  async updateWin(userId: string, id: string, dto: UpdateWinDto): Promise<WinDto> {
    const updated = await this.wins.findOneAndUpdate({ _id: this.oid(id, 'Win'), userId }, { $set: dto }, { new: true });
    if (!updated) throw new NotFoundException(`Win ${id} not found`);
    return updated.toJSON() as unknown as WinDto;
  }

  async removeWin(userId: string, id: string) {
    const deleted = await this.wins.findOneAndDelete({ _id: this.oid(id, 'Win'), userId });
    if (!deleted) throw new NotFoundException(`Win ${id} not found`);
    return { id, deleted: true as const };
  }

  // ---------------------------------------------------------------- detail & summary

  /** Everything one board's detail page needs, honouring its `features`. */
  async detail(userId: string, idOrKey: string, today: string) {
    const board = await this.resolve(userId, idOrKey);
    const [tasks, notes, people, contributions, wins] = await Promise.all([
      this.listTasks(userId, board.id),
      board.features.includes('notes') ? this.listNotes(userId, board.id) : Promise.resolve([]),
      board.features.includes('people') ? this.listPeople(userId, board.id) : Promise.resolve([]),
      board.features.includes('contributions')
        ? this.listContributions(userId, board.id)
        : Promise.resolve([]),
      board.features.includes('wins') ? this.listWins(userId, board.id) : Promise.resolve([]),
    ]);

    return {
      board,
      tasks,
      notes,
      people: people.map((p) => ({ ...p, oneOnOneOverdue: this.isOneOnOneOverdue(p, today) })),
      contributions,
      wins,
      summary: this.summariseBoard(board, { tasks, people, contributions, wins }, today),
    };
  }

  async summaries(userId: string, today: string): Promise<BoardSummary[]> {
    const boards = await this.list(userId);
    if (!boards.length) return [];

    const ids = boards.map((b) => b.id);
    const [tasks, people, contributions, wins] = await Promise.all([
      this.tasks.find({ userId, boardId: { $in: ids } }),
      this.people.find({ userId, boardId: { $in: ids }, archived: false }),
      this.contributions.find({ userId, boardId: { $in: ids } }),
      this.wins.find({ userId, boardId: { $in: ids } }),
    ]);

    const group = <T extends { boardId: string; toJSON: () => unknown }>(rows: T[]) => {
      const map = new Map<string, unknown[]>();
      for (const row of rows) {
        const bucket = map.get(row.boardId);
        if (bucket) bucket.push(row.toJSON());
        else map.set(row.boardId, [row.toJSON()]);
      }
      return map;
    };

    const tasksByBoard = group(tasks);
    const peopleByBoard = group(people);
    const contributionsByBoard = group(contributions);
    const winsByBoard = group(wins);

    return boards.map((board) =>
      this.summariseBoard(
        board,
        {
          tasks: (tasksByBoard.get(board.id) ?? []) as BoardTaskDto[],
          people: (peopleByBoard.get(board.id) ?? []) as PersonDto[],
          contributions: (contributionsByBoard.get(board.id) ?? []) as ContributionDto[],
          wins: (winsByBoard.get(board.id) ?? []) as WinDto[],
        },
        today,
      ),
    );
  }

  private summariseBoard(
    board: BoardDto,
    data: {
      tasks: BoardTaskDto[];
      people: PersonDto[];
      contributions: ContributionDto[];
      wins: WinDto[];
    },
    today: string,
  ): BoardSummary {
    const open = data.tasks.filter((t) => OPEN_STATUSES.includes(t.status));
    const overdue = open.filter((t) => t.dueDate && isAfter(today, toDay(t.dueDate)));
    const windowStart = addMonths(today, -CONTRIBUTION_WINDOW_MONTHS);
    const recent = data.contributions.filter((c) => toDay(c.date) >= windowStart);

    const hasPeople = board.features.includes('people');
    const hasContributions = board.features.includes('contributions');

    return {
      boardId: board.id,
      key: board.key,
      name: board.name,
      kind: board.kind,
      accent: board.accent,
      features: board.features,
      openTaskCount: open.length,
      urgentTaskCount: open.filter((t) => t.priority <= 2).length,
      overdueTaskCount: overdue.length,
      nextDueDate: minDay(...open.map((t) => t.dueDate)),
      topTasks: [...open]
        .sort((a, b) => a.priority - b.priority || (a.dueDate ?? '9999') .localeCompare(b.dueDate ?? '9999'))
        .slice(0, 3)
        .map((t) => ({ id: t.id, title: t.title, priority: t.priority as Priority, dueDate: t.dueDate })),
      peopleCount: hasPeople ? data.people.length : undefined,
      needsAttentionCount: hasPeople
        ? data.people.filter((p) => p.attentionState === 'needs_attention' || p.attentionState === 'at_risk').length
        : undefined,
      upcomingAttentionCount: hasPeople
        ? data.people.filter((p) => p.attentionState === 'upcoming').length
        : undefined,
      overdueOneOnOneCount: hasPeople
        ? data.people.filter((p) => this.isOneOnOneOverdue(p, today)).length
        : undefined,
      contributionPointsLast6Months: hasContributions
        ? recent.reduce((sum, c) => sum + c.points, 0)
        : undefined,
      contributionCountLast6Months: hasContributions ? recent.length : undefined,
      winCount: board.features.includes('wins') ? data.wins.length : undefined,
    };
  }

  private oid(id: string, entity: string): string {
    if (!isValidObjectId(id)) throw new NotFoundException(`${entity} ${id} not found`);
    return id;
  }
}
