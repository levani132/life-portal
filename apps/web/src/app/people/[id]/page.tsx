'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '../../../components/app-shell';
import { ProfileView } from '../../../components/social';
import { Spinner } from '../../../components/ui';
import { useAuth } from '../../../lib/auth-context';
import { actingPageId } from '../../../lib/identity';

/**
 * Someone's profile. Your own id goes to `/profile` (the Profile tab), so your profile is the same
 * page however you reach it: your name on a post, a shared link, a comment.
 */
export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  // Spec 040: "your own" is the identity in use. Acting as a page, your person's profile is
  // someone else's from here; only the page's own id goes to the Portal tab.
  const own = !!user && id === (actingPageId() ?? user.id);
  useEffect(() => {
    if (own) router.replace('/profile', { scroll: false });
  }, [own, router]);
  return (
    <AppShell>
      {own ? <Spinner label="Opening your profile…" /> : <ProfileView userId={id} />}
    </AppShell>
  );
}
