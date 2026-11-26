/**
 * Spec 046: where to go after signing in or joining, from `?next=`. Only a path inside this app
 * (one leading slash, no scheme, no `//`), so a link can never send someone elsewhere.
 */
export function nextPath(search: string): string {
  const value = new URLSearchParams(search).get('next');
  return value && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : '/';
}
