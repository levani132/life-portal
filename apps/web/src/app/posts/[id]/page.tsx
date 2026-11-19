'use client';
import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { type FoodPost } from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { PostCard } from '../../../components/posts';
import { ErrorNote, Spinner } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { useApi } from '../../../lib/hooks';
import { SOCIAL_REFRESH } from '../../../lib/social-hooks';
export default function PostPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <PostDetail />
      </Suspense>
    </AppShell>
  );
}
function PostDetail() {
  const { id } = useParams<{ id: string }>();
  // `?share=1`: arrived from sharing something in Food or Training, so the share sheet opens.
  const share = useSearchParams().get('share') === '1';
  const result = useApi<FoodPost>(`/posts/${id}`, SOCIAL_REFRESH);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Post" />
      {/* Only the server's refusal means the post is gone; with no connection the post already
          shown stays, so it can still be liked or commented on offline (spec 031). */}
      {result.error instanceof ApiError ? (
        <ErrorNote message="This post is unavailable or its audience has changed." />
      ) : result.data ? (
        <PostCard post={result.data} detail openShare={share} />
      ) : result.error ? (
        <ErrorNote message="This post can’t be loaded without a connection." />
      ) : (
        <Spinner />
      )}
    </div>
  );
}
