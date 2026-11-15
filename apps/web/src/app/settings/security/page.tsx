'use client';

import { useSWRConfig } from 'swr';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { ChangePasswordPanel, DevicesPanel, EmailPanel, GooglePanel } from '../../../components/account-security';

export default function SecurityPage() {
  return (
    <AppShell>
      <Security />
    </AppShell>
  );
}

function Security() {
  const { mutate } = useSWRConfig();
  return (
    <>
      <PageHeader title="Sign-in & security" subtitle="How you sign in, and the devices signed in to your account." />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChangePasswordPanel onChanged={() => void mutate('/auth/sessions')} />
        <DevicesPanel />
        <EmailPanel />
        <GooglePanel />
      </div>
    </>
  );
}
