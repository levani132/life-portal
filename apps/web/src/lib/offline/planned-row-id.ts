/**
 * Spec 028: the id the server gives the workout exercise a plan start makes for one planned
 * exercise — sha256 of `lp-planned:<requestId>:<planExerciseId>`, first 24 hex digits. The API's
 * `planned-row-id.ts` computes the same; both test the same vector. Knowing it before the server
 * does is what lets sets be logged against a plan workout started offline.
 */
export async function plannedRowId(requestId: string, planExerciseId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`lp-planned:${requestId}:${planExerciseId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A new id in MongoDB ObjectId form (time prefix plus random), chosen by the client. */
export function newObjectId(nowMs = Date.now()): string {
  const time = Math.floor(nowMs / 1000).toString(16).padStart(8, '0');
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  return time + Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
