'use client';
import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { type FoodPost } from '@life-portal/shared-types';
import { AppShell } from '../../../components/app-shell';
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
  const params = useSearchParams();
  const share = params.get('share') === '1';
  // A link-only post's key, from its link: the server opens the post to this account with it.
  const key = params.get('k');
  const result = useApi<FoodPost>(`/posts/${id}${key ? `?k=${encodeURIComponent(key)}` : ''}`, SOCIAL_REFRESH);
  return (
    // Edge to edge on a phone, like the post in the feed: no title, no frame around it.
    <div className="-mx-4 -mt-6 sm:mx-auto sm:mt-0 sm:max-w-2xl">
      {/* Only the server's refusal means the post is gone; with no connection the post already
          shown stays, so it can still be liked or commented on offline (spec 031). */}
      {result.error instanceof ApiError ? (
        <div className="p-4">
          <ErrorNote message="This post is unavailable or its audience has changed." />
        </div>
      ) : result.data ? (
        <PostCard post={result.data} detail openShare={share} focusCommentId={params.get('comment') ?? undefined} />
      ) : result.error ? (
        <div className="p-4">
          <ErrorNote message="This post can’t be loaded without a connection." />
        </div>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
