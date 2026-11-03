import type { CannotSendReason, FeatureAccess } from '@life-portal/shared-types';

/** One conversation per pair: the same key whichever member asks. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/**
 * Whether `a` may message `b` now. Only accepted friends, unblocked, both with the feature.
 * History stays readable whatever this says; it only governs sending (spec FR-001, FR-003).
 */
export function canMessage(input: {
  connection?: { state: string; blockedBy: string[] } | null;
  accessA: FeatureAccess | null;
  accessB: FeatureAccess | null;
}): CannotSendReason | null {
  const { connection, accessA, accessB } = input;
  if (connection?.blockedBy.length) return 'blocked';
  if (connection?.state !== 'accepted') return 'not-friends';
  if (!accessA?.messages || !accessA.social || !accessB?.messages || !accessB.social)
    return 'feature';
  return null;
}

const PREVIEW_LIMIT = 80;

/** One line for the inbox: "You: …", "Shared a post", "Message unsent". */
export function messagePreview(input: {
  kind: 'text' | 'post';
  text?: string;
  unsent: boolean;
  fromMe: boolean;
}): string {
  const body = input.unsent
    ? 'Message unsent'
    : input.kind === 'post'
      ? 'Shared a post'
      : (input.text ?? '').replace(/\s+/g, ' ').trim();
  const line = input.fromMe ? `You: ${body}` : body;
  return line.length > PREVIEW_LIMIT ? `${line.slice(0, PREVIEW_LIMIT - 1).trimEnd()}…` : line;
}

/** A member who synced the conversation this recently is looking at it (spec FR-018). */
export const VIEWING_WINDOW_MS = 15_000;

export function isViewing(viewingAt: Date | undefined, now: Date): boolean {
  return !!viewingAt && now.getTime() - viewingAt.getTime() <= VIEWING_WINDOW_MS;
}

/** The label under your most recent message. */
export function seenLabel(
  lastMineAt: string | undefined,
  otherLastReadAt: string | undefined,
): 'Seen' | 'Sent' | null {
  if (!lastMineAt) return null;
  return otherLastReadAt && Date.parse(otherLastReadAt) >= Date.parse(lastMineAt)
    ? 'Seen'
    : 'Sent';
}

/** Messages further apart than this get a time label between them. */
export const SEPARATOR_GAP_MS = 15 * 60_000;

/** Indexes (into a chronological list) that start a new time group. The first always does. */
export function timeSeparators(createdAt: string[]): number[] {
  return createdAt.flatMap((at, index) =>
    index === 0 || Date.parse(at) - Date.parse(createdAt[index - 1]) > SEPARATOR_GAP_MS
      ? [index]
      : [],
  );
}
