'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { PostComposer } from '../../components/post-composer';
import { parseNewPostSource } from '../../lib/new-post';

/**
 * The new post page. It sits outside the swiping tabs: the shell hides its header and tab bar
 * here, and closing goes back to wherever the person came from.
 */
function NewPost() {
  const router = useRouter();
  const params = useSearchParams();
  const source = parseNewPostSource(params.get('source'));
  const close = () => {
    if (window.history.length > 1) router.back();
    else router.replace('/');
  };
  return (
    <PostComposer
      key={params.get('source') ?? 'empty'}
      initialSource={source}
      onClose={close}
      onDone={(path) => router.replace(path)}
    />
  );
}

export default function NewPostPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <NewPost />
      </Suspense>
    </AppShell>
  );
}
