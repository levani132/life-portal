'use client';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { Conversation } from '../../../components/messages';

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AppShell>
      <Conversation key={id} id={id} />
    </AppShell>
  );
}
