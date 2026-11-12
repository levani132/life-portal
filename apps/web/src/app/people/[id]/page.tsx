'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '../../../components/app-shell';
import { ProfileView } from '../../../components/social';
import { Spinner } from '../../../components/ui';
import { useAuth } from '../../../lib/auth-context';

/**
 * Someone's profile. Your own id goes to `/profile` (the Profile tab), so your profile is the same
 * page however you reach it: your name on a post, a shared link, a comment.
 */
export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const own = !!user && id === user.id;
  useEffect(() => {
    if (own) router.replace('/profile', { scroll: false });
  }, [own, router]);
  return (
    <AppShell>
      {own ? <Spinner label="Opening your profile…" /> : <ProfileView userId={id} />}
    </AppShell>
  );
}
