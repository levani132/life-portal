'use client';

import { useEffect, useState } from 'react';
import type { PublicFood, PublicFoodsResponse } from '@life-portal/shared-types';
import { mgToG } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { EmptyState, Input, Modal, Panel, Spinner } from './ui';

/**
 * Panel for browsing and importing public foods from other users.
 */
export function PublicFoodsPanel({
  hasPublicFoods,
  onImported,
}: {
  hasPublicFoods: boolean;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (!hasPublicFoods) return null;

  return (
    <>
      <Panel
        title="Import from others"
        description="Other users have shared foods you can add to your database."
      >
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
          Browse public foods
        </button>
      </Panel>

      <PublicFoodsModal
        open={open}
        onClose={() => setOpen(false)}
        onImported={() => {
          onImported();
          setOpen(false);
        }}
      />
    </>
  );
}

function PublicFoodsModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [query, setQuery] = useState('');
  const [foods, setFoods] = useState<PublicFood[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const { run, pending, error } = useAction();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    params.set('limit', '50');

    api
      .get<PublicFoodsResponse>(`/nutrition/foods/public?${params}`)
      .then((response) => {
        setFoods(response.foods);
        setTotal(response.total);
      })
      .catch(() => {
        setFoods([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [open, query]);

  const importFood = (food: PublicFood) =>
    void run(async () => {
      await api.post(`/nutrition/foods/import-public/${food.id}`);
    }).then((ok) => {
      if (ok) onImported();
    });

  return (
    <Modal open={open} onClose={onClose} title="Public foods" wide>
      <div className="space-y-4">
        <Input
          type="search"
          placeholder="Search by name or brand…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {error && (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}

        {loading ? (
          <Spinner label="Loading public foods…" />
        ) : foods.length === 0 ? (
          <EmptyState
            message={
              query.trim()
                ? 'No public foods match that search.'
                : 'No public foods available yet.'
            }
          />
        ) : (
          <>
            <p className="text-xs text-ink-faint">
              {total} public food{total === 1 ? '' : 's'} available
            </p>
            <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {foods.map((food) => (
                <li
                  key={food.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {food.name}
                      {food.brand && (
                        <span className="ml-1 text-xs text-ink-faint">{food.brand}</span>
                      )}
                    </p>
                    <p className="text-xs text-ink-faint">
                      {food.servingSize} {food.unit} serving · {food.energyKcalPer100} kcal/100
                      {food.unit} · P {mgToG(food.proteinMgPer100)}g
                      <span className="ml-2">shared by {food.sharedByName}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary shrink-0"
                    onClick={() => importFood(food)}
                    disabled={pending}
                  >
                    Import
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
