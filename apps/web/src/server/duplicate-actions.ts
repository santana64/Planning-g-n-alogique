'use server';

import { getTranslations } from 'next-intl/server';
import { DUPLICATE_SCORER_VERSION } from '@chronolignee/genealogy';
import {
  MergeRefused,
  UndoRefused,
  dismissDuplicate,
  mergePeople,
  undoMerge,
} from '@chronolignee/db';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { enqueueDuplicateScan } from '@/lib/queue';
import { redirect } from '@/i18n/navigation';
import { getLocale } from 'next-intl/server';
import type { ActionState } from './action-state';
import { authoriseWrite, peopleWritable } from './authorise';
import { revalidateTree } from './revalidate';

/**
 * The three things a reader can do with a suspected duplicate: look for more,
 * say two records are not the same person, or make them one.
 *
 * The merge asks for the right to delete, not merely to contribute: it
 * retires a record, and a contributor's whole point is that they never
 * remove anything.
 */

/** How long a scan may take to reach the queue before the page gives up. */
const ENQUEUE_TIMEOUT_MS = 5_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

export async function scanDuplicatesAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'contribute');
  if ('error' in authorised) return authorised.error;

  try {
    const queued = await within(
      enqueueDuplicateScan(authorised.access.treeId, DUPLICATE_SCORER_VERSION),
      ENQUEUE_TIMEOUT_MS,
    );
    revalidateTree(treeSlug);
    return {
      status: 'success',
      message: t(queued ? 'duplicates.scanQueued' : 'duplicates.scanRunning'),
    };
  } catch (error) {
    // The reader is told the queue is not answering; the log says what
    // actually happened, because a rejected job id reads exactly like a
    // Redis outage from the outside.
    logger.error(
      {
        event: 'duplicates.scan.not_queued',
        treeId: authorised.access.treeId,
        error: error instanceof Error ? error.message : typeof error,
      },
      'duplicate scan not queued',
    );
    return {
      status: 'error',
      message: t('duplicates.queueUnavailable'),
    };
  }
}

export async function dismissDuplicateAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'contribute');
  if ('error' in authorised) return authorised.error;

  const candidateId = text(form, 'candidateId');
  if (!isUuid(candidateId)) return { status: 'error', message: t('duplicates.pairNotFound') };

  await dismissDuplicate(db, { treeId: authorised.access.treeId, candidateId });
  revalidateTree(treeSlug);
  // Back to the list from either screen: the comparison page this may have
  // been submitted from now describes a pair that no longer exists.
  redirect({ href: `/app/${treeSlug}/doublons`, locale: await getLocale() });
  // Not reached: redirect throws. Typed as returning, so said explicitly.
  return { status: 'success', message: t('duplicates.dismissed') };
}

/**
 * Merge, then send the reader to the record that survived.
 *
 * The redirect is server-side and in the same response: revalidating the
 * merged person's page while the client is still on it is how a deletion
 * ended up showing a 404 (docs/PROJECT_STATUS.md, bug 45).
 */
export async function mergeDuplicateAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'delete');
  if ('error' in authorised) return authorised.error;

  const keepId = text(form, 'keepId');
  const mergeId = text(form, 'mergeId');
  // The same guard as every other write naming a person: a record this
  // author may not see must refuse exactly as one that does not exist.
  if (!(await peopleWritable(authorised.access, [keepId, mergeId]))) {
    return { status: 'error', message: t('duplicates.recordsNotFound') };
  }

  try {
    const result = await mergePeople(
      db,
      { treeId: authorised.access.treeId, keepId, mergeId },
      { actorId: authorised.userId },
    );
    logger.info(
      {
        event: 'people.merged',
        treeId: authorised.access.treeId,
        kept: result.keptId,
        merged: result.mergedId,
        relationships: result.relationships,
        events: result.events,
      },
      'people merged',
    );
    revalidateTree(treeSlug);
    redirect({ href: `/app/${treeSlug}/personnes/${result.keptId}`, locale: await getLocale() });
    return { status: 'success', message: t('duplicates.merged') };
  } catch (error) {
    if (error instanceof MergeRefused) {
      return { status: 'error', message: t('duplicates.mergeRefused') };
    }
    throw error;
  }
}

/**
 * Put a merge back. The same right as the merge itself: it brings a retired
 * record back to life and moves rows between two people.
 */
export async function undoMergeAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'delete');
  if ('error' in authorised) return authorised.error;

  const revisionId = text(form, 'revisionId');
  if (!isUuid(revisionId))
    return { status: 'error', message: t('duplicates.undoRefused.NOT_FOUND') };

  try {
    const result = await undoMerge(
      db,
      { treeId: authorised.access.treeId, revisionId },
      { actorId: authorised.userId },
    );
    logger.info(
      {
        event: 'people.merge_undone',
        treeId: authorised.access.treeId,
        restored: result.restoredId,
      },
      'merge undone',
    );
  } catch (error) {
    if (error instanceof UndoRefused) {
      return { status: 'error', message: t(`duplicates.undoRefused.${error.reason}`) };
    }
    throw error;
  }
  revalidateTree(treeSlug);
  return { status: 'success', message: t('duplicates.undone') };
}
