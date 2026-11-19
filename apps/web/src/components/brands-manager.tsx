'use client';

import { useRef, useState } from 'react';
import { Globe, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { BRAND_NAME_MAX, type FoodBrand, type PortalState } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { useBrands } from '../lib/brands';
import { revalidate, useApi } from '../lib/hooks';
import { brandKey, cleanBrandName } from '@life-portal/shared-domain';
import { prepareLogo, uploadMedia } from '../lib/media';
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

  const files = useRef<HTMLInputElement>(null);
  const [bulk, setBulk] = useState<string | null>(null);

  /**
   * Logos for many brands at once: each file is matched to a brand by its file name
   * ("mcdonalds.png", "Burger King.jpg"), in any spelling. A name with no brand yet becomes a
   * new one: public when the developer has "Public" ticked, their own otherwise.
   */
  async function addLogos(list: FileList) {
    setError(null);
    setBusy(true);
    const editable = brands.filter((brand) => brand.scope === 'own' || developer);
    const failed: string[] = [];
    let done = 0;
    for (const file of Array.from(list)) {
      const label = cleanBrandName(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
      setBulk(`Adding logos: ${done + failed.length + 1} of ${list.length}`);
      try {
        const key = brandKey(label);
        if (!key) throw new Error('no name');
        const brand =
          editable.find((item) => item.key === key) ??
          (await api.post<FoodBrand>('/nutrition/brands', { name: label, ...(developer && asPublic ? { public: true } : {}) }));
        const imageMediaId = await uploadMedia(await prepareLogo(file), () => undefined, new AbortController().signal);
        await api.patch(`/nutrition/brands/${brand.id}`, { imageMediaId });
        done += 1;
      } catch {
        failed.push(file.name);
      }
    }
    setBulk(null);
    setBusy(false);
    await refresh();
    if (failed.length) setError(`${done} added. Could not add: ${failed.join(', ')}.`);
  }

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
            <span className="label">Logos from files</span>
            <input
              ref={files}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files?.length) void addLogos(event.target.files);
                event.target.value = '';
              }}
            />
            <button type="button" className="btn-ghost w-full justify-center" disabled={busy} onClick={() => files.current?.click()}>
              <ImagePlus size={15} aria-hidden /> {bulk ?? 'Choose logo files'}
            </button>
            <p className="mt-1.5 text-xs text-ink-faint">
              Name each file after its brand (mcdonalds.png, Burger King.jpg). Each logo is trimmed and centred on the same white
              square, so they all look alike. A name with no brand yet is added as a new brand.
            </p>
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
        hint="The brand’s logo. It is trimmed and centred on a white square, the same for every brand."
        prepare={prepareLogo}
      />
      <Field label="Name" hint="Renaming it renames it on the foods that have it.">
        <Input value={name} maxLength={BRAND_NAME_MAX} onChange={(event) => setName(event.target.value)} required />
      </Field>
    </Modal>
  );
}
