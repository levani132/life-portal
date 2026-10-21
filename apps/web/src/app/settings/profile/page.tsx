'use client';
import Link from 'next/link';
import { useState } from 'react';
import type {
  SocialProfile,
  SocialProfileUpdate,
} from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { useSocialApi } from '../../../components/social';
import {
  ErrorNote,
  Field,
  Input,
  Spinner,
  Textarea,
} from '../../../components/ui';
import { api } from '../../../lib/api';
import { revalidate, useAction } from '../../../lib/hooks';
export default function ProfileSettingsPage() {
  return (
    <AppShell>
      <ProfileSettings />
    </AppShell>
  );
}
function ProfileSettings() {
  const profile = useSocialApi<SocialProfile>('/social/me');
  if (profile.error)
    return <ErrorNote message={(profile.error as Error).message} />;
  if (!profile.data) return <Spinner />;
  return <ProfileEditor profile={profile.data} />;
}
function ProfileEditor({ profile }: { profile: SocialProfile }) {
  const [form, setForm] = useState<SocialProfileUpdate>({
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    discoverable: profile.discoverable ?? false,
  });
  const [saved, setSaved] = useState(false);
  const action = useAction();
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Edit profile"
        subtitle="Choose what people see when they find you."
      />
      <form
        className="card space-y-5 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(false);
          void action.run(
            async () => {
              await api.put('/social/me', form);
              await revalidate('/social');
              setSaved(true);
            },
            { revalidate: false },
          );
        }}
      >
        <fieldset disabled={action.pending} className="space-y-5">
          <Field label="Display name">
            <Input
              value={form.displayName}
              maxLength={80}
              required
              onChange={(event) => {
                setForm({ ...form, displayName: event.target.value });
                setSaved(false);
              }}
            />
          </Field>
          <Field
            label="Username"
            hint="3–30 lowercase letters, numbers, underscores or hyphens."
          >
            <Input
              value={form.username}
              pattern="[a-z0-9][a-z0-9_-]{2,29}"
              maxLength={30}
              required
              onChange={(event) => {
                setForm({
                  ...form,
                  username: event.target.value.toLowerCase(),
                });
                setSaved(false);
              }}
            />
          </Field>
          <Field
            label="About you"
            hint="Optional. Your bio is visible to anyone who can open your profile."
          >
            <Textarea
              value={form.bio}
              maxLength={300}
              onChange={(event) => {
                setForm({ ...form, bio: event.target.value });
                setSaved(false);
              }}
            />
          </Field>
          <label className="flex items-start gap-3 rounded-xl border border-border p-4">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-sky-400"
              checked={form.discoverable}
              onChange={(event) => {
                setForm({ ...form, discoverable: event.target.checked });
                setSaved(false);
              }}
            />
            <span>
              <span className="block font-medium">Let people find me</span>
              <span className="mt-1 block text-xs text-ink-muted">
                Appear in name and username search. Your email is never shown.
                Profile links work even when this is off.
              </span>
            </span>
          </label>
          {action.error && <ErrorNote message={action.error} />}
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={action.pending}>
              {action.pending ? 'Saving…' : 'Save profile'}
            </button>
            {saved && (
              <span className="text-sm text-emerald-400" role="status">
                Saved
              </span>
            )}
          </div>
        </fieldset>
      </form>
      <Link href="/profile" className="btn-ghost mt-4">
        View my profile
      </Link>
    </div>
  );
}
