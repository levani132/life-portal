import { POST_KINDS, type PostSelection, type TrainingPostSelection } from '@life-portal/shared-types';
import { validTrainingSelection } from '@life-portal/shared-domain';

/** The new post page, opened with a Food selection already attached. */
export function newPostHref(source?: PostSelection): string {
  return source ? `/new?source=${encodeURIComponent(JSON.stringify(source))}` : '/new';
}

/** Reads `?source=` back. Anything malformed is ignored: the page opens empty instead. */
export function parseNewPostSource(value: string | null): PostSelection | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as PostSelection;
    return parsed && (POST_KINDS as readonly string[]).includes(parsed.kind) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Spec 036: the new post page with something from Training attached. */
export function newTrainingPostHref(training: TrainingPostSelection): string {
  return `/new?training=${encodeURIComponent(JSON.stringify(training))}`;
}

/** Reads `?training=` back. Anything malformed is ignored: the page opens empty instead. */
export function parseNewPostTraining(value: string | null): TrainingPostSelection | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as TrainingPostSelection;
    return validTrainingSelection(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
