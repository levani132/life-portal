'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  Food,
  FoodEntryMode,
  FoodLookupResponse,
  FoodLookupResult,
  FoodUnit,
} from '@life-portal/shared-types';
import { factsFromInput, factsToInput, macroEnergyMismatch, mgToG } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { Field, Input, Modal, Select, Spinner } from './ui';

/** Long enough that typing "chicken" is one search, not seven. The API allows ten a minute. */
const SEARCH_DEBOUNCE_MS = 400;
const MIN_QUERY = 3;

type Tab = 'manual' | 'lookup';

interface NumberFields {
  energyKcal: string;
  proteinG: string;
  fatG: string;
  carbG: string;
  fibreG: string;
  sugarG: string;
  satFatG: string;
  sodiumMg: string;
}

const EMPTY: NumberFields = {
  energyKcal: '',
  proteinG: '',
  fatG: '',
  carbG: '',
  fibreG: '',
  sugarG: '',
  satFatG: '',
  sodiumMg: '',
};

/**
 * Add or edit a food.
 *
 * The numbers are typed in grams, the way a packet states them, and stored as milligrams — the
 * conversion happens here and in `factsFromInput`, never by hand. `entryMode` records whether the
 * owner typed per-serving or per-100 figures, so reopening the form shows what they wrote rather
 * than a normalised version of it.
 */
export function FoodForm({
  open,
  onClose,
  food,
  lookupAvailable,
  lookupReason,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  food?: Food;
  lookupAvailable: boolean;
  lookupReason?: string;
  onSaved?: () => void;
}) {
  const editing = food != null;
  const { run, pending, error, clearError } = useAction();

  const [tab, setTab] = useState<Tab>('manual');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [unit, setUnit] = useState<FoodUnit>('g');
  const [servingSize, setServingSize] = useState('100');
  const [servingLabel, setServingLabel] = useState('');
  const [entryMode, setEntryMode] = useState<FoodEntryMode>('per_serving');
  const [favourite, setFavourite] = useState(false);
  const [numbers, setNumbers] = useState<NumberFields>(EMPTY);

  useEffect(() => {
    if (!open) return;
    clearError();
    setTab('manual');
    if (food) {
      const typed = factsToInput(food, food.entryMode, food.servingSize);
      setName(food.name);
      setBrand(food.brand ?? '');
      setUnit(food.unit);
      setServingSize(String(food.servingSize));
      setServingLabel(food.servingLabel ?? '');
      setEntryMode(food.entryMode);
      setFavourite(food.favourite);
      setNumbers({
        energyKcal: String(typed.energyKcal),
        proteinG: String(mgToG(typed.proteinMg, 1)),
        fatG: String(mgToG(typed.fatMg, 1)),
        carbG: String(mgToG(typed.carbMg, 1)),
        fibreG: typed.fibreMg != null ? String(mgToG(typed.fibreMg, 1)) : '',
        sugarG: typed.sugarMg != null ? String(mgToG(typed.sugarMg, 1)) : '',
        satFatG: typed.satFatMg != null ? String(mgToG(typed.satFatMg, 1)) : '',
        sodiumMg: typed.sodiumMg != null ? String(typed.sodiumMg) : '',
      });
    } else {
      setName('');
      setBrand('');
      setUnit('g');
      setServingSize('100');
      setServingLabel('');
      setEntryMode('per_serving');
      setFavourite(false);
      setNumbers(EMPTY);
    }
  }, [open, food, clearError]);

  const num = (value: string): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  const optional = (value: string): number | undefined =>
    value.trim() === '' ? undefined : Math.round(num(value) * 1000);

  const payload = {
    name: name.trim(),
    brand: brand.trim() || undefined,
    unit,
    servingSize: Math.max(1, Math.round(num(servingSize))),
    servingLabel: servingLabel.trim() || undefined,
    entryMode,
    energyKcal: Math.round(num(numbers.energyKcal)),
    proteinMg: Math.round(num(numbers.proteinG) * 1000),
    fatMg: Math.round(num(numbers.fatG) * 1000),
    carbMg: Math.round(num(numbers.carbG) * 1000),
    fibreMg: optional(numbers.fibreG),
    sugarMg: optional(numbers.sugarG),
    satFatMg: optional(numbers.satFatG),
    sodiumMg: numbers.sodiumMg.trim() === '' ? undefined : Math.round(num(numbers.sodiumMg)),
    favourite,
  };

  /**
   * Do the macros account for the stated energy? Shown before saving, because the most likely
   * mistake here is per-serving numbers typed into the per-100 boxes, and the maths can see it.
   */
  const mismatch = useMemo(() => {
    if (payload.energyKcal <= 0) return undefined;
    return macroEnergyMismatch(factsFromInput(payload, entryMode, payload.servingSize));
  }, [payload, entryMode]);

  const submit = () =>
    void run(async () => {
      if (editing) await api.patch(`/nutrition/foods/${food.id}`, payload);
      else await api.post('/nutrition/foods', payload);
    }).then((ok) => {
      if (ok) {
        onSaved?.();
        onClose();
      }
    });

  const perLabel = entryMode === 'per_100' ? `per 100 ${unit}` : 'per serving';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${food.name}` : 'Add a food'}
      onSubmit={submit}
      submitLabel={editing ? 'Save food' : 'Add food'}
      pending={pending}
      error={error}
      wide
    >
      {!editing && (
        <div className="flex gap-1 rounded-lg border border-border p-1 text-sm">
          {(['manual', 'lookup'] as Tab[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTab(option)}
              className={
                tab === option
                  ? 'flex-1 rounded-md bg-surface-raised px-3 py-1.5 text-ink'
                  : 'flex-1 rounded-md px-3 py-1.5 text-ink-muted hover:text-ink'
              }
            >
              {option === 'manual' ? 'From the packet' : 'Search Open Food Facts'}
            </button>
          ))}
        </div>
      )}

      {tab === 'lookup' && !editing ? (
        <LookupTab
          available={lookupAvailable}
          reason={lookupReason}
          onImported={() => {
            onSaved?.();
            onClose();
          }}
          onUseManually={(result) => {
            setTab('manual');
            setName(result.name);
            setBrand(result.brand ?? '');
            setUnit(result.unit);
            setServingSize(String(result.servingSize ?? 100));
            setEntryMode('per_100');
            setNumbers({
              energyKcal: result.energyKcalPer100 != null ? String(result.energyKcalPer100) : '',
              proteinG: result.proteinMgPer100 != null ? String(mgToG(result.proteinMgPer100, 1)) : '',
              fatG: result.fatMgPer100 != null ? String(mgToG(result.fatMgPer100, 1)) : '',
              carbG: result.carbMgPer100 != null ? String(mgToG(result.carbMgPer100, 1)) : '',
              fibreG: result.fibreMgPer100 != null ? String(mgToG(result.fibreMgPer100, 1)) : '',
              sugarG: result.sugarMgPer100 != null ? String(mgToG(result.sugarMgPer100, 1)) : '',
              satFatG: result.satFatMgPer100 != null ? String(mgToG(result.satFatMgPer100, 1)) : '',
              sodiumMg: result.sodiumMgPer100 != null ? String(result.sodiumMgPer100) : '',
            });
          }}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <Field label="Brand" hint="optional">
              <Input value={brand} onChange={(event) => setBrand(event.target.value)} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Measured in">
              <Select value={unit} onChange={(event) => setUnit(event.target.value as FoodUnit)}>
                <option value="g">grams</option>
                <option value="ml">millilitres</option>
              </Select>
            </Field>
            <Field label={`Serving size (${unit})`}>
              <Input
                inputMode="numeric"
                value={servingSize}
                onChange={(event) => setServingSize(event.target.value)}
                required
              />
            </Field>
            <Field label="Serving name" hint='e.g. "1 slice"'>
              <Input value={servingLabel} onChange={(event) => setServingLabel(event.target.value)} />
            </Field>
          </div>

          <Field
            label="The numbers below are"
            hint="whichever the packet states — both are stored the same way"
          >
            <Select
              value={entryMode}
              onChange={(event) => setEntryMode(event.target.value as FoodEntryMode)}
            >
              <option value="per_serving">per serving</option>
              <option value="per_100">per 100 {unit}</option>
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={`Calories ${perLabel}`}>
              <Input
                inputMode="numeric"
                value={numbers.energyKcal}
                onChange={(event) => setNumbers({ ...numbers, energyKcal: event.target.value })}
                required
              />
            </Field>
            <Field label="Protein (g)">
              <Input
                inputMode="decimal"
                value={numbers.proteinG}
                onChange={(event) => setNumbers({ ...numbers, proteinG: event.target.value })}
              />
            </Field>
            <Field label="Carbs (g)">
              <Input
                inputMode="decimal"
                value={numbers.carbG}
                onChange={(event) => setNumbers({ ...numbers, carbG: event.target.value })}
              />
            </Field>
            <Field label="Fat (g)">
              <Input
                inputMode="decimal"
                value={numbers.fatG}
                onChange={(event) => setNumbers({ ...numbers, fatG: event.target.value })}
              />
            </Field>
          </div>

          <details className="rounded-lg border border-border px-3 py-2">
            <summary className="cursor-pointer text-xs uppercase tracking-wide text-ink-faint">
              Fibre, sugar, saturated fat, sodium — optional
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <Field label="Fibre (g)">
                <Input
                  inputMode="decimal"
                  value={numbers.fibreG}
                  onChange={(event) => setNumbers({ ...numbers, fibreG: event.target.value })}
                />
              </Field>
              <Field label="Sugar (g)">
                <Input
                  inputMode="decimal"
                  value={numbers.sugarG}
                  onChange={(event) => setNumbers({ ...numbers, sugarG: event.target.value })}
                />
              </Field>
              <Field label="Saturated fat (g)">
                <Input
                  inputMode="decimal"
                  value={numbers.satFatG}
                  onChange={(event) => setNumbers({ ...numbers, satFatG: event.target.value })}
                />
              </Field>
              <Field label="Sodium (mg)">
                <Input
                  inputMode="numeric"
                  value={numbers.sodiumMg}
                  onChange={(event) => setNumbers({ ...numbers, sodiumMg: event.target.value })}
                />
              </Field>
            </div>
          </details>

          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={favourite}
              onChange={(event) => setFavourite(event.target.checked)}
              className="h-4 w-4 rounded border-border bg-surface"
            />
            Keep this one near the top of the list
          </label>

          {mismatch && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Those macros work out to about {mismatch.impliedKcal} kcal per 100 {unit}, not{' '}
              {factsFromInput(payload, entryMode, payload.servingSize).energyKcalPer100}. Worth
              checking whether the calories and the macros are stated the same way — it will save
              as entered either way.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

/**
 * Open Food Facts search. Everything here degrades: no key is needed, but the service is
 * rate-limited and sometimes down, in which case this panel says so and the manual tab is the
 * answer (constitution: external APIs degrade gracefully).
 */
function LookupTab({
  available,
  reason,
  onImported,
  onUseManually,
}: {
  available: boolean;
  reason?: string;
  onImported: () => void;
  onUseManually: (result: FoodLookupResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [barcode, setBarcode] = useState('');
  const [status, setStatus] = useState<FoodLookupResponse>({ available, results: [] });
  const [searching, setSearching] = useState(false);
  const { run, pending, error } = useAction();

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setStatus({ available, results: [] });
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get<FoodLookupResponse>(`/nutrition/foods/lookup?q=${encodeURIComponent(trimmed)}`)
        .then((response) => {
          if (!cancelled) setStatus(response);
        })
        .catch(() => {
          if (!cancelled) {
            setStatus({
              available: false,
              reason: 'The lookup could not be reached. Add the food by hand instead.',
              results: [],
            });
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, available]);

  const importByCode = (code: string) =>
    void run(async () => {
      await api.post('/nutrition/foods/import', { code });
    }).then((ok) => {
      if (ok) onImported();
    });

  return (
    <div className="space-y-3">
      {!available && reason && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {reason}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Search by name" hint="at least three letters">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="greek yoghurt"
          />
        </Field>
        <Field label="Or a barcode">
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="5901234123457"
            />
            <button
              type="button"
              className="btn-ghost shrink-0"
              disabled={pending || barcode.trim().length < 6}
              onClick={() => importByCode(barcode.trim())}
            >
              Import
            </button>
          </div>
        </Field>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      {searching && <Spinner label="Searching Open Food Facts…" />}

      {!searching && status.results.length > 0 && (
        <>
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {status.results.map((result) => (
              <li key={result.code} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{result.name}</p>
                  <p className="truncate text-xs text-ink-faint">
                    {[result.brand, result.energyKcalPer100 != null ? `${result.energyKcalPer100} kcal / 100 ${result.unit}` : 'no calorie figure']
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => onUseManually(result)}
                    title="Copy these numbers into the form so you can check them"
                  >
                    Check first
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={pending || result.energyKcalPer100 == null}
                    onClick={() => importByCode(result.code)}
                  >
                    Import
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-snug text-ink-faint">
            {status.results[0]?.attribution}
          </p>
        </>
      )}

      {!searching && query.trim().length >= MIN_QUERY && status.results.length === 0 && (
        <p className="text-xs text-ink-faint">
          {status.reason ?? 'Nothing found. The packet in your hand is more reliable anyway.'}
        </p>
      )}
    </div>
  );
}
