export const HEALTH_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
export function healthSyncDue(
  lastSync: string | undefined,
  now: number,
): boolean {
  const received = lastSync ? Date.parse(lastSync) : NaN;
  return (
    !Number.isFinite(received) || now - received >= HEALTH_SYNC_INTERVAL_MS
  );
}
/** No web callback: returning to an HTTPS URL can open another Safari tab on iOS. */
export interface HealthShortcutInput {
  token: string;
  uploadUrl: string;
  limitPerKind: number;
}
export function healthShortcutUrl(input: HealthShortcutInput): string {
  return `shortcuts://run-shortcut?name=Life Portal Health&input=text&text=${encodeURIComponent(JSON.stringify(input))}`;
}
