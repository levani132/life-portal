'use client';

import { useState } from 'react';
import { Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import { BRAND_NAME_MAX, type FoodBrand, type PortalState } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { useBrands } from '../lib/brands';
import { revalidate, useApi } from '../lib/hooks';
import { BrandMark } from './brand-mark';
import { FoodPhotoField, foodPhotoPayload, type FoodPhotoChange } from './food-photo-field';
import { EmptyState, ErrorNote, Field, Input, Modal } from './ui';

const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

/**
 * A person's own brands: add one, rename it, give it a logo, remove it. The developer also
 * sees the public brands here, can add a public one, and can make one of their own public.
 * A brand a food is saved with is created on its own; this is where it gets its logo.
 */
export function BrandsManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { brands, loaded, refresh } = useBrands();
  const portal = useApi<PortalState>('/portal');
  const developer = portal.data?.cohort === 'developer';
  const [editing, setEditing] = useState<FoodBrand | null>(null);
  const [name, setName] = useState('');
  const [asPublic, setAsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const own = brands.filter((brand) => brand.scope === 'own');
  const shared = developer ? brands.filter((brand) => brand.scope === 'public') : [];

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      // A renamed brand renames it on foods too, so the Food day is read again.
      await Promise.all([refresh(), revalidate('/nutrition')]);
      return true;
    } catch (caught) {
      setError(message(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    void run(() => api.post('/nutrition/brands', { name: name.trim(), ...(developer && asPublic ? { public: true } : {}) })).then((ok) => {
      if (ok) setName('');
    });

  const row = (brand: FoodBrand) => (
    <li key={brand.id} className="flex items-center gap-2.5 rounded-xl bg-surface px-2.5 py-2">
      <BrandMark name={brand.name} brand={brand} size={32} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{brand.name}</span>
      {developer && brand.scope === 'own' && (
        <button
          type="button"
          className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-muted hover:bg-surface-raised hover:text-ink"
          disabled={busy}
          title="Everyone will see this brand"
          onClick={() => {
            if (window.confirm(`Make "${brand.name}" a public brand, for everyone?`)) void run(() => api.post(`/nutrition/brands/${brand.id}/publish`));
          }}
        >
          <Globe size={14} aria-hidden /> Make public
        </button>
      )}
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-raised hover:text-ink"
        aria-label={`Edit ${brand.name}`}
        onClick={() => {
          setError(null);
          setEditing(brand);
        }}
      >
        <Pencil size={15} aria-hidden />
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-raised hover:text-danger"
        aria-label={`Remove ${brand.name}`}
        disabled={busy}
        onClick={() => {
          if (window.confirm(`Remove the brand "${brand.name}"? Foods keep the name, without a logo.`)) void run(() => api.delete(`/nutrition/brands/${brand.id}`));
        }}
      >
        <Trash2 size={15} aria-hidden />
      </button>
    </li>
  );

  return (
    <>
      <Modal open={open && !editing} onClose={onClose} title="Brands">
        <div className="space-y-4">
          {error && <ErrorNote message={error} />}
          <div>
            <span className="label">Add a brand</span>
            <div className="flex gap-2">
              <Input
                value={name}
                maxLength={BRAND_NAME_MAX}
                placeholder="Brand name"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && name.trim()) {
                    event.preventDefault();
                    add();
                  }
                }}
              />
              <button type="button" className="btn-primary shrink-0" disabled={busy || !name.trim()} onClick={add}>
                <Plus size={15} aria-hidden /> Add
              </button>
            </div>
            {developer && (
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" checked={asPublic} onChange={(event) => setAsPublic(event.target.checked)} />
                Public: everyone sees it
              </label>
            )}
          </div>
          <div>
            <span className="label">Your brands</span>
            {!loaded ? (
              <p className="text-sm text-ink-faint">Loading…</p>
            ) : own.length ? (
              <ul className="space-y-1.5">{own.map(row)}</ul>
            ) : (
              <EmptyState message="None yet. A brand you type on a food that isn’t a known brand is saved here." />
            )}
          </div>
          {shared.length > 0 && (
            <div>
              <span className="label">Public brands</span>
              <ul className="space-y-1.5">{shared.map(row)}</ul>
            </div>
          )}
        </div>
      </Modal>
      {editing && (
        <BrandEditor
          brand={editing}
          error={error}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(body) =>
            void run(() => api.patch(`/nutrition/brands/${editing.id}`, body)).then((ok) => {
              if (ok) setEditing(null);
            })
          }
        />
      )}
    </>
  );
}

function BrandEditor({
  brand,
  error,
  busy,
  onClose,
  onSave,
}: {
  brand: FoodBrand;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(brand.name);
  const [logo, setLogo] = useState<FoodPhotoChange>({ kind: 'keep' });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${brand.name}`}
      onSubmit={() => onSave({ ...(name.trim() !== brand.name ? { name: name.trim() } : {}), ...foodPhotoPayload(logo) })}
      submitLabel="Save"
      pending={busy || logo.kind === 'uploading'}
      error={error}
    >
      <FoodPhotoField
        image={brand.logoUrl ? { url: brand.logoUrl, width: 1, height: 1 } : undefined}
        onChange={setLogo}
        hint="The brand’s logo. Shown beside its foods and on the brand filters."
      />
      <Field label="Name" hint="Renaming it renames it on the foods that have it.">
        <Input value={name} maxLength={BRAND_NAME_MAX} onChange={(event) => setName(event.target.value)} required />
      </Field>
    </Modal>
  );
}
