'use client';
import { useState } from 'react';
import { AppShell, PageHeader } from '../../components/app-shell';
import { PostsList } from '../../components/posts';
import { PostComposer } from '../../components/post-composer';
export default function WallPage() {
  return (
    <AppShell>
      <Wall />
    </AppShell>
  );
}
function Wall() {
  const [composing, setComposing] = useState(false);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Wall"
        subtitle="Food posts from you and your friends."
        actions={
          <button className="btn-primary" onClick={() => setComposing(true)}>
            Share food
          </button>
        }
      />
      <PostsList />
      {composing && <PostComposer onClose={() => setComposing(false)} />}
    </div>
  );
}
