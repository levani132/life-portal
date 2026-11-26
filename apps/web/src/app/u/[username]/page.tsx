'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { PublicPortalView } from '../../../components/public-portal';
import { ProfileView } from '../../../components/social';
import { ErrorNote, Spinner } from '../../../components/ui';
import { useAuth } from '../../../lib/auth-context';
import { useApi } from '../../../lib/hooks';

/**
 * Spec 046: a portal's address (`/@username`, rewritten here). A member sees the portal as any
 * profile; someone without an account sees its public side, then an invitation to join.
 */
export default function PortalAddressPage() {
  const { username } = useParams<{ username: string }>();
  const { user, loading } = useAuth();
  const name = decodeURIComponent(username).replace(/^@/, '');
  if (loading) return <Spinner />;
  if (!user) return <PublicPortalView username={name} />;
  return (
    <AppShell>
      <MemberPortal username={name} />
    </AppShell>
  );
}

function MemberPortal({ username }: { username: string }) {
  const found = useApi<{ userId: string }>(`/social/usernames/${encodeURIComponent(username)}`);
  if (found.error) return <ErrorNote message="This portal isn’t available. It may be private, or the address may be wrong." />;
  if (!found.data) return <Spinner />;
  return <ProfileView userId={found.data.userId} />;
}
