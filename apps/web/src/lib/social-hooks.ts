'use client';
import { useEffect, useState } from 'react';
import { mealContextNow } from './local-day';
import { useApi } from './hooks';
export const SOCIAL_REFRESH = {
  revalidateOnFocus: true,
  refreshInterval: 15000,
  dedupingInterval: 1000,
};
export function useSocialApi<T>(path: string | null) {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setToday(mealContextNow().day);
    update();
    const timer = window.setInterval(update, 60000);
    return () => window.clearInterval(timer);
  }, []);
  return useApi<T>(
    path && today
      ? `${path}${path.includes('?') ? '&' : '?'}today=${today}`
      : null,
    SOCIAL_REFRESH,
  );
}
