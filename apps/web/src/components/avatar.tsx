'use client';
import clsx from 'clsx';
import { useState } from 'react';

/**
 * A person's profile photo, or the first letter of their name on a soft tint when there is none
 * (or the signed link has expired and the image fails to load). Decorative: the name is always
 * written next to it, so it is hidden from screen readers.
 */
export function Avatar({
  name,
  url,
  size = 44,
  className,
}: {
  name: string;
  url?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = !!url && failed !== url;
  return (
    <span
      aria-hidden
      className={clsx(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sky-500/15 font-semibold text-sky-300',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {showPhoto ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(url)}
        />
      ) : (
        (name.trim()[0] ?? '?').toUpperCase()
      )}
    </span>
  );
}
