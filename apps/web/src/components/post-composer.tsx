'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MEAL_SLOTS,
  POST_KINDS,
  type Audience,
  type NutritionOverview,
  type PostPreview,
  type PostSelection,
} from '@life-portal/shared-types';
import { publicationCalories } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { mealContextNow } from '../lib/local-day';
import {
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from './ui';
export const POST_KIND_LABELS = {
  entry: 'One logged food',
  meal: 'A whole meal',
  day: 'A whole day',
  food: 'A food from my database',
  combination: 'A food combination',
  database: 'My food database',
} as const;
export function PostComposer({
  onClose,
  initialSource,
  initialDay,
}: {
  onClose: () => void;
  initialSource?: PostSelection;
  initialDay?: string;
}) {
  const [kind, setKind] = useState<PostSelection['kind']>(
    initialSource?.kind ?? 'entry',
  );
  const [day, setDay] = useState(
    initialSource?.day ?? initialDay ?? mealContextNow().day,
  );
  const [slot, setSlot] = useState(initialSource?.slot ?? 'breakfast');
  const [entryId, setEntryId] = useState(initialSource?.entryId ?? '');
  const [foodId, setFoodId] = useState(initialSource?.foodId ?? '');
  const [savedMealId, setSavedMealId] = useState(
    initialSource?.savedMealId ?? '',
  );
  const [components, setComponents] = useState(initialSource?.components ?? []);
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<Audience>('private');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const router = useRouter();
  const overview = useApi<NutritionOverview>(
    `/nutrition?day=${day}&today=${mealContextNow().day}`,
  );
  const entries =
    overview.data?.dayTotals.slots.flatMap((s) => s.entries) ?? [];
  const source: PostSelection =
    kind === 'entry'
      ? { kind, entryId }
      : kind === 'meal'
        ? { kind, day, slot }
        : kind === 'day'
          ? { kind, day }
          : kind === 'food'
            ? { kind, foodId }
            : kind === 'database'
              ? { kind }
              : savedMealId
                ? { kind, savedMealId }
                : { kind, components };
  async function prepare() {
    setPending(true);
    setError(null);
    try {
      const next = await api.post<PostPreview>('/posts/preview', { source });
      setPreview(next);
      setTitle(next.publication.label.slice(0, 120));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not preview this selection.',
      );
    } finally {
      setPending(false);
    }
  }
  async function publish() {
    if (!preview) return;
    setPending(true);
    setError(null);
    try {
      const post = await api.post<{ id: string }>('/posts', {
        source,
        title,
        caption,
        audience,
        previewHash: preview.previewHash,
        requestId,
      });
      await revalidate('/posts');
      onClose();
      router.push(`/posts/${post.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish.');
    } finally {
      setPending(false);
    }
  }
  const items = preview?.publication.items;
  return (
    <Modal
      open
      onClose={onClose}
      title={preview ? 'Review your food post' : 'Share something from Food'}
      wide
    >
      <fieldset disabled={pending} className="space-y-4">
        {error && (
          <div role="alert">
            <ErrorNote message={error} />
          </div>
        )}
        {!preview ? (
          <>
            <p className="text-sm text-ink-muted">
              Choose exactly what you want to share. You’ll review the post and
              its audience before publishing.
            </p>
            <Field label="What to share">
              <Select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as PostSelection['kind'])
                }
              >
                {POST_KINDS.map((value) => (
                  <option value={value} key={value}>
                    {POST_KIND_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            {['entry', 'meal', 'day'].includes(kind) && (
              <Field label="Day">
                <Input
                  type="date"
                  value={day}
                  onChange={(e) => {
                    setDay(e.target.value);
                    setEntryId('');
                  }}
                />
              </Field>
            )}
            {overview.error ? (
              <ErrorNote message={(overview.error as Error).message} />
            ) : !overview.data ? (
              <Spinner />
            ) : (
              <>
                {kind === 'entry' && (
                  <Field label="Logged food">
                    <Select
                      value={entryId}
                      onChange={(e) => setEntryId(e.target.value)}
                    >
                      <option value="">Choose a logged food</option>
                      {entries.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.facts.name} · {entry.amount} {entry.unit} ·{' '}
                          {entry.slot}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {kind === 'meal' && (
                  <Field label="Meal">
                    <Select
                      value={slot}
                      onChange={(e) => setSlot(e.target.value as typeof slot)}
                    >
                      {MEAL_SLOTS.map((value) => (
                        <option key={value} value={value}>
                          {value[0].toUpperCase() + value.slice(1)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {kind === 'food' && (
                  <Field label="Food">
                    <Select
                      value={foodId}
                      onChange={(e) => setFoodId(e.target.value)}
                    >
                      <option value="">Choose a food</option>
                      {overview.data.foods
                        .filter((food) => !food.archived)
                        .map((food) => (
                          <option key={food.id} value={food.id}>
                            {food.name}
                            {food.brand ? ` · ${food.brand}` : ''}
                          </option>
                        ))}
                    </Select>
                  </Field>
                )}
                {kind === 'combination' && (
                  <>
                    <Field label="Start from">
                      <Select
                        value={savedMealId}
                        onChange={(e) => setSavedMealId(e.target.value)}
                      >
                        <option value="">Choose foods and amounts</option>
                        {overview.data.savedMeals
                          .filter((meal) => meal.loggable)
                          .map((meal) => (
                            <option key={meal.id} value={meal.id}>
                              {meal.name}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    {!savedMealId && (
                      <div className="space-y-3">
                        {overview.data.foods
                          .filter((food) => !food.archived)
                          .map((food) => {
                            const chosen = components.find(
                              (c) => c.foodId === food.id,
                            );
                            return (
                              <div
                                key={food.id}
                                className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"
                              >
                                <label className="flex flex-1 items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={!!chosen}
                                    onChange={(e) =>
                                      setComponents((current) =>
                                        e.target.checked
                                          ? [
                                              ...current,
                                              {
                                                foodId: food.id,
                                                amount: food.servingSize,
                                              },
                                            ]
                                          : current.filter(
                                              (c) => c.foodId !== food.id,
                                            ),
                                      )
                                    }
                                  />
                                  <span>{food.name}</span>
                                </label>
                                {chosen && (
                                  <label className="flex items-center gap-2 text-sm">
                                    <Input
                                      type="number"
                                      min={1}
                                      max={20000}
                                      step={1}
                                      aria-label={`${food.name} amount`}
                                      className="w-24"
                                      value={chosen.amount}
                                      onChange={(e) =>
                                        setComponents((current) =>
                                          current.map((c) =>
                                            c.foodId === food.id
                                              ? {
                                                  ...c,
                                                  amount: Number(
                                                    e.target.value,
                                                  ),
                                                }
                                              : c,
                                          ),
                                        )
                                      }
                                    />
                                    {food.unit}
                                  </label>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </>
                )}
                {kind === 'database' && (
                  <div className="rounded-xl border border-border p-4 text-sm text-ink-muted">
                    This creates a frozen collection of all{' '}
                    {
                      overview.data.foods.filter((food) => !food.archived)
                        .length
                    }{' '}
                    active foods in your database. Private food notes,
                    favourites, meal history, goals and body measurements are
                    excluded.
                  </div>
                )}
                {['entry', 'meal', 'day'].includes(kind) &&
                  entries.length === 0 && (
                    <p className="text-sm text-ink-muted">
                      Nothing logged on this day. Choose another day or share a
                      food from your database.
                    </p>
                  )}
                <button
                  type="button"
                  className="btn-primary"
                  disabled={pending}
                  onClick={() => void prepare()}
                >
                  {pending ? 'Preparing…' : 'Preview post'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <Field label="Post title">
              <Input
                value={title}
                maxLength={120}
                required
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Caption" hint="Optional">
              <Textarea
                value={caption}
                maxLength={1000}
                onChange={(e) => setCaption(e.target.value)}
              />
            </Field>
            <Field label="Who can see this post">
              <Select
                value={audience}
                onChange={(e) => setAudience(e.target.value as Audience)}
              >
                <option value="private">Only me</option>
                <option value="friends">Friends</option>
                <option value="public">Everyone in Life Portal</option>
              </Select>
            </Field>
            <div className="rounded-xl border border-border p-4">
              <p className="mb-3 text-sm font-medium">
                {items!.length} food{items!.length === 1 ? '' : 's'}
                {publicationCalories(items!) !== undefined
                  ? ` · ${publicationCalories(items!)} kcal`
                  : ''}
              </p>
              <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
                {items!.map((item) => (
                  <li key={item.key}>
                    {item.name}
                    {item.brand ? ` · ${item.brand}` : ''}{' '}
                    <span className="text-ink-muted">
                      {item.amount === undefined
                        ? `${item.energyKcalPer100} kcal / 100 ${item.unit}`
                        : `${item.amount} ${item.unit}`}
                      {item.slot ? ` · ${item.slot}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-ink-muted">
              This post shares only the foods above. Your live widget and diary
              settings won’t change. Shared facts stay as posted; edits to your
              database won’t update this post. Imported copies belong to their
              recipients and cannot be recalled.
            </p>
            {kind === 'database' && (
              <p className="text-xs text-ink-muted">
                Collection version 1. Publishing a later update creates a new
                post.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
              >
                Change selection
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!title.trim() || pending}
                onClick={() => void publish()}
              >
                {pending
                  ? 'Posting…'
                  : audience === 'private'
                    ? 'Post for only me'
                    : 'Publish post'}
              </button>
            </div>
          </>
        )}
      </fieldset>
    </Modal>
  );
}
