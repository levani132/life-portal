'use client';
import { useParams } from 'next/navigation';
import { type FoodPost } from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { PostCard } from '../../../components/posts';
import { ErrorNote, Spinner } from '../../../components/ui';
import { useApi } from '../../../lib/hooks';
import { SOCIAL_REFRESH } from '../../../lib/social-hooks';
export default function PostPage() {
  return (
    <AppShell>
      <PostDetail />
    </AppShell>
  );
}
function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const result = useApi<FoodPost>(`/posts/${id}`, SOCIAL_REFRESH);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Food post" />
      {result.error ? (
        <ErrorNote message="This post is unavailable or its audience has changed." />
      ) : !result.data ? (
        <Spinner />
      ) : (
        <PostCard post={result.data} detail />
      )}
    </div>
  );
}
