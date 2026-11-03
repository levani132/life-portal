'use client';
import { useEffect, useState } from 'react';

export function isIOSDevice(
  device: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>,
): boolean {
  return (
    /iPhone|iPad|iPod/i.test(device.userAgent) ||
    (/Mac/i.test(device.platform) && device.maxTouchPoints > 1)
  );
}

/** Unknown until mount so server rendering never flashes iOS-only controls. */
export function useIsIOS(): boolean | null {
  const [ios, setIOS] = useState<boolean | null>(null);
  useEffect(() => {
    setIOS(isIOSDevice(navigator));
  }, []);
  return ios;
}
