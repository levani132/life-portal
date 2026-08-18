import { NotFoundException } from '@nestjs/common';
import { isValidObjectId, type Model, type QueryFilter, type UpdateQuery } from 'mongoose';

/**
 * Base class for every user-scoped collection.
 *
 * Its whole job is to make it impossible to write a query that forgets `userId`
 * (constitution: "No endpoint may return another user's rows"). Subclasses add domain
 * behaviour; they never build a bare filter.
 *
 * Note on typing: Mongoose 9 renamed `FilterQuery` to `QueryFilter` and removed
 * `RootFilterQuery`. See `docs/DECISIONS.md`.
 */
export abstract class OwnedCrudService<TDoc> {
  protected constructor(
    protected readonly model: Model<TDoc>,
    /** Used in "not found" messages, e.g. `Loan`. */
    protected readonly entityName: string,
  ) {}

  /** Every read and write funnels through here, so the owner clause can never be omitted. */
  protected scoped(userId: string, extra: Record<string, unknown> = {}): QueryFilter<TDoc> {
    return { ...extra, userId } as QueryFilter<TDoc>;
  }

  /** Default sort. Override for collections with a meaningful order. */
  protected defaultSort(): Record<string, 1 | -1> {
    return { createdAt: -1 };
  }

  async findAll(userId: string, filter: Record<string, unknown> = {}): Promise<TDoc[]> {
    const rows = await this.model.find(this.scoped(userId, filter)).sort(this.defaultSort());
    return rows.map((row) => this.serialize(row));
  }

  /** Returns the hydrated document, for callers that need to mutate and save it. */
  async findRaw(userId: string, id: string) {
    this.assertObjectId(id);
    const found = await this.model.findOne(this.scoped(userId, { _id: id }));
    if (!found) throw new NotFoundException(`${this.entityName} ${id} not found`);
    return found;
  }

  async findOne(userId: string, id: string): Promise<TDoc> {
    return this.serialize(await this.findRaw(userId, id));
  }

  async create(userId: string, dto: Record<string, unknown>): Promise<TDoc> {
    const created = await this.model.create({ ...dto, userId } as never);
    return this.serialize(created);
  }

  async update(userId: string, id: string, dto: Record<string, unknown>): Promise<TDoc> {
    this.assertObjectId(id);
    // `userId` is stripped from the payload so a crafted body cannot reassign ownership.
    const { userId: _ignored, ...safe } = dto;
    const updated = await this.model.findOneAndUpdate(
      this.scoped(userId, { _id: id }),
      { $set: safe } as UpdateQuery<TDoc>,
      { new: true, runValidators: true },
    );
    if (!updated) throw new NotFoundException(`${this.entityName} ${id} not found`);
    return this.serialize(updated);
  }

  async remove(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    this.assertObjectId(id);
    const deleted = await this.model.findOneAndDelete(this.scoped(userId, { _id: id }));
    if (!deleted) throw new NotFoundException(`${this.entityName} ${id} not found`);
    return { id, deleted: true };
  }

  async count(userId: string, filter: Record<string, unknown> = {}): Promise<number> {
    return this.model.countDocuments(this.scoped(userId, filter));
  }

  /** A malformed id is a 404, not a 500 from Mongo's ObjectId cast. */
  protected assertObjectId(id: string): void {
    if (!isValidObjectId(id)) throw new NotFoundException(`${this.entityName} ${id} not found`);
  }

  /** Applies the schema's `toJSON` transform so callers always see `id`, never `_id`. */
  protected serialize(doc: unknown): TDoc {
    const candidate = doc as { toJSON?: () => unknown };
    return (typeof candidate?.toJSON === 'function' ? candidate.toJSON() : doc) as TDoc;
  }
}
