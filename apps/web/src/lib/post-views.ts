'use client';

import { api } from './api';

/**
 * Spec 045: posts of pages this person saw, sent in small batches for the pages' insights. The
 * server counts each once per person, post and day and keeps no viewer. Best effort: views seen
 * offline, or a send that fails, are simply not counted.
 */
const waiting = new Set<string>();
const sentToday = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  timer = undefined;
  if (!waiting.size) return;
  const ids = [...waiting].slice(0, 50);
  for (const id of ids) waiting.delete(id);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  void api.post('/posts/views', { ids }).catch(() => undefined);
  if (waiting.size) timer = setTimeout(flush, 2000);
}

export function recordPostView(postId: string): void {
  if (sentToday.has(postId)) return;
  sentToday.add(postId);
  waiting.add(postId);
  if (!timer) timer = setTimeout(flush, 2000);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer);
      flush();
    }
  });
}
