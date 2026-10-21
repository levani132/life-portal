'use client';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { ProfileView } from '../../../components/social';
export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AppShell>
      <ProfileView userId={id} />
    </AppShell>
  );
}
