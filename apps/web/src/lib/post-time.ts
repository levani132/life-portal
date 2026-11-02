export function postTimeLabel(value: string, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return 'Recently';
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return 'Recently';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (seconds <= 7 * 86400) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
