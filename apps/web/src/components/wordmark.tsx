import clsx from 'clsx';
import { APP_WORDMARK } from '../lib/brand';

/**
 * The app's name as its mark: one word, one colour. Deliberately plain, and not two-toned:
 * another company's logo writes the same word in two tones.
 */
export function Wordmark({ className }: { className?: string }) {
  return <span className={clsx('font-bold tracking-tight text-ink', className)}>{APP_WORDMARK}</span>;
}
