import type { Collection, Document } from 'mongodb';

/**
 * Upsert on a natural key, so re-running a seed never creates a second copy.
 *
 * Takes the raw driver `Collection` (from `db.collection(...)`) rather than a Mongoose model,
 * because the seed deliberately writes without schemas: it must be able to populate a database
 * whose models have since moved on.
 */
export async function upsert<T extends Record<string, unknown>>(
  collection: Collection<Document>,
  key: Record<string, unknown>,
  doc: T,
): Promise<string> {
  const now = new Date();
  const result = await collection.findOneAndUpdate(
    key,
    { $set: { ...doc, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true, returnDocument: 'after' },
  );
  return String(result?.['_id']);
}
