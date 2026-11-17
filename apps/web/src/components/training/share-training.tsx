'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { Share2 } from 'lucide-react';
import type { PortalState, TrainingPostSelection } from '@life-portal/shared-types';
import { useApi } from '../../lib/hooks';
import { newTrainingPostHref } from '../../lib/new-post';

/** Whether this member can share from Training (spec 036): posts, Training and its sharing switch. */
export function useCanShareTraining(): boolean {
  const access = useApi<PortalState>('/portal').data?.access;
  return !!access && access.social && access.nutrition && access.foodPosts && access.training && access.trainingPosts;
}

/**
 * Opens the new post page with something from Training attached. What is shared, and with whom,
 * is decided there, on a preview of exactly what others will see. Renders nothing without the
 * feature.
 */
export function ShareTrainingLink({
  selection,
  label = 'Share',
  iconOnly = false,
  className,
}: {
  selection: TrainingPostSelection;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  if (!useCanShareTraining()) return null;
  return (
    <Link href={newTrainingPostHref(selection)} className={clsx(className)} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}>
      <Share2 className="h-4 w-4" aria-hidden />
      {!iconOnly && <> {label}</>}
    </Link>
  );
}
