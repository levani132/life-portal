'use client';
import { AppShell } from '../../components/app-shell';
import { PeopleSearch } from '../../components/people-search';

export default function SearchPage() {
  return (
    <AppShell>
      <PeopleSearch />
    </AppShell>
  );
}
