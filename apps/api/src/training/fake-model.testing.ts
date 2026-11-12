import { Types } from 'mongoose';

/**
 * A tiny in-memory stand-in for a Mongoose model, for the training service specs. It supports
 * the query shapes those services use (equality, `$in`, `$ne`, `$lt`, `$exists`, `$or`,
 * sort/limit/skip/select/lean) and unique indexes, which is what the invariants under test
 * depend on. It is not a general Mongo emulator.
 */
type Doc = Record<string, unknown> & { _id: Types.ObjectId };

/** A deep copy that keeps ObjectIds and Dates intact (`structuredClone` strips their class). */
function clone<T>(value: T): T {
  if (value instanceof Types.ObjectId) return new Types.ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  }
  return value;
}
type Filter = Record<string, unknown>;

const same = (a: unknown, b: unknown) => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && !Array.isArray(b)) return a.some((item) => same(item, b));
  return String(a) === String(b);
};

const compare = (a: unknown, b: unknown) => {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  return (av as number) < (bv as number) ? -1 : (av as number) > (bv as number) ? 1 : 0;
};

function matchesValue(value: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !(condition instanceof Date) && !(condition instanceof Types.ObjectId) && !Array.isArray(condition)) {
    return Object.entries(condition as Record<string, unknown>).every(([op, arg]) => {
      switch (op) {
        case '$in': return (arg as unknown[]).some((item) => same(value, item));
        case '$ne': return !same(value, arg);
        case '$lt': return value !== undefined && compare(value, arg) < 0;
        case '$exists': return (value !== undefined) === arg;
        case '$regex': return typeof value === 'string' && new RegExp(arg as string).test(value);
        default: throw new Error(`fake model: unsupported operator ${op}`);
      }
    });
  }
  return same(value, condition);
}

export function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return (condition as Filter[]).some((branch) => matches(doc, branch));
    const value = key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], doc);
    return matchesValue(value, condition);
  });
}

class FakeQuery<T> implements PromiseLike<T> {
  private sortSpec?: Record<string, 1 | -1>;
  private limitN?: number;
  private skipN = 0;
  constructor(private readonly rows: () => Doc[], private readonly single: boolean) {}
  sort(spec: Record<string, 1 | -1>) { this.sortSpec = spec; return this; }
  limit(n: number) { this.limitN = n; return this; }
  skip(n: number) { this.skipN = n; return this; }
  select() { return this; }
  lean<R = T>() { return this as unknown as FakeQuery<R>; }
  private run(): T {
    let rows = this.rows();
    if (this.sortSpec) {
      const spec = Object.entries(this.sortSpec);
      rows = [...rows].sort((a, b) => {
        for (const [key, dir] of spec) {
          const c = compare(a[key], b[key]);
          if (c) return c * dir;
        }
        return 0;
      });
    }
    rows = rows.slice(this.skipN, this.limitN === undefined ? undefined : this.skipN + this.limitN);
    const copies = rows.map((row) => clone(row));
    return (this.single ? (copies[0] ?? null) : copies) as T;
  }
  then<A, B>(ok?: ((value: T) => A | PromiseLike<A>) | null, fail?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, fail);
  }
}

export class FakeModel {
  readonly docs: Doc[] = [];
  constructor(private readonly unique: string[][] = []) {}

  private violates(doc: Doc, ignore?: Doc) {
    return this.unique.some((keys) => {
      const partial = keys[keys.length - 1]?.startsWith('?') ? keys[keys.length - 1].slice(1) : undefined;
      const fields = partial ? keys.slice(0, -1) : keys;
      if (partial) {
        const [field, value] = partial.split('=');
        if (String(doc[field]) !== value) return false;
      }
      return this.docs.some(
        (other) =>
          other !== ignore &&
          (!partial || String(other[partial.split('=')[0]]) === partial.split('=')[1]) &&
          fields.every((field) => other[field] !== undefined && same(other[field], doc[field])),
      );
    });
  }

  find(filter: Filter = {}) { return new FakeQuery<Doc[]>(() => this.docs.filter((doc) => matches(doc, filter)), false); }
  findOne(filter: Filter = {}) { return new FakeQuery<Doc | null>(() => this.docs.filter((doc) => matches(doc, filter)), true); }

  async create(input: Record<string, unknown>) {
    const doc = { _id: new Types.ObjectId(), createdAt: new Date(), ...clone(input) } as Doc;
    if (this.violates(doc)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    this.docs.push(doc);
    return { ...doc, toObject: () => clone(doc) };
  }

  private apply(doc: Doc, update: Record<string, Record<string, unknown>>) {
    Object.assign(doc, update['$set'] ?? {});
    for (const key of Object.keys(update['$unset'] ?? {})) delete doc[key];
  }

  async updateOne(filter: Filter, update: Record<string, Record<string, unknown>>) {
    const doc = this.docs.find((row) => matches(row, filter));
    if (doc) this.apply(doc, update);
    return { matchedCount: doc ? 1 : 0 };
  }

  async deleteOne(filter: Filter) {
    const index = this.docs.findIndex((row) => matches(row, filter));
    if (index >= 0) this.docs.splice(index, 1);
    return { deletedCount: index >= 0 ? 1 : 0 };
  }

  async deleteMany(filter: Filter) {
    const keep = this.docs.filter((row) => !matches(row, filter));
    const deletedCount = this.docs.length - keep.length;
    this.docs.splice(0, this.docs.length, ...keep);
    return { deletedCount };
  }

  async countDocuments(filter: Filter = {}) {
    return this.docs.filter((doc) => matches(doc, filter)).length;
  }

  async bulkWrite(ops: { updateOne: { filter: Filter; update: Record<string, Record<string, unknown>>; upsert?: boolean } }[]) {
    let upsertedCount = 0;
    let modifiedCount = 0;
    for (const { updateOne } of ops) {
      const doc = this.docs.find((row) => matches(row, updateOne.filter));
      if (doc) {
        this.apply(doc, updateOne.update);
        modifiedCount++;
      } else if (updateOne.upsert) {
        const created = { _id: new Types.ObjectId(), ...updateOne.filter, ...(updateOne.update['$setOnInsert'] ?? {}) } as Doc;
        this.apply(created, updateOne.update);
        this.docs.push(created);
        upsertedCount++;
      }
    }
    return { upsertedCount, modifiedCount };
  }
}
