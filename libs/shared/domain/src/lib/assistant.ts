import {
  ASSISTANT_ACTION_KINDS,
  ASSISTANT_CAP_DEFAULTS,
  ASSISTANT_CAP_MAX,
  ASSISTANT_CAP_NONE,
  type AssistantActionKind,
  type AssistantCapOverride,
  type AssistantCaps,
} from '@life-portal/shared-types';

const valid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && (value === ASSISTANT_CAP_NONE || (value >= 0 && value <= ASSISTANT_CAP_MAX));

/** Stored defaults made whole: a missing or malformed kind falls back to the code's default. */
export function assistantDefaults(stored?: Partial<Record<string, unknown>> | null): AssistantCaps {
  return Object.fromEntries(
    ASSISTANT_ACTION_KINDS.map((kind) => [kind, valid(stored?.[kind]) ? (stored?.[kind] as number) : ASSISTANT_CAP_DEFAULTS[kind]]),
  ) as AssistantCaps;
}

/**
 * How many actions of a kind the assistant may take as one page in a day (spec 041): the
 * person's own override if the owner set one, otherwise the default. `null` is no cap, which
 * is also what the owner's own account always has.
 */
export function assistantCap(input: {
  kind: AssistantActionKind;
  defaults: AssistantCaps;
  override?: AssistantCapOverride | null;
  developer: boolean;
}): number | null {
  if (input.developer) return null;
  const own = input.override?.[input.kind];
  const cap = valid(own) ? own : input.defaults[input.kind];
  return cap === ASSISTANT_CAP_NONE ? null : cap;
}

/** Whether one more action fits under the cap. */
export function underAssistantCap(used: number, cap: number | null): boolean {
  return cap === null || used < cap;
}

/**
 * Whether two accounts share a manager (spec 041): the assistant never likes, comments on,
 * follows or messages a page run by the same person, so one person's pages cannot be made to
 * look like a crowd. A person counts as their own manager.
 */
export function sharesManager(a: readonly string[], b: readonly string[]): boolean {
  return a.some((id) => b.includes(id));
}
