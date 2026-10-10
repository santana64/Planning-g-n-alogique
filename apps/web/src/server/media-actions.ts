'use server';

import { getTranslations } from 'next-intl/server';
import { ZodError } from 'zod';
import {
  MediaNotFound,
  tagPersonInMedia,
  untagPersonInMedia,
  updateDocumentTranscription,
  updateMediaDetails,
} from '@chronolignee/db';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ids';
import type { ActionState } from './action-state';
import { authoriseWrite, peopleWritable } from './authorise';
import { loadDocumentView } from './documents';
import { loadPhoto } from './media';
import { revalidateTree } from './revalidate';

/**
 * Who is in a photograph, what it shows, and what a document says.
 *
 * Contributors may do all three: none changes a fact about anyone's life.
 * Every write naming a person goes through the visibility check, and a
 * photograph must itself be visible to the author — a tag is a statement
 * about a face, and a face this author may not see is not theirs to name.
 */

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function fraction(form: FormData, field: string): number | null {
  const raw = text(form, field);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function tagPersonAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions.media');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'contribute');
  if ('error' in authorised) return authorised.error;

  const mediaId = text(form, 'mediaId');
  const personId = text(form, 'personId');
  if (!isUuid(mediaId) || !(await loadPhoto(treeSlug, mediaId))) {
    return { status: 'error', message: t('notFound') };
  }
  if (!isUuid(personId) || !(await peopleWritable(authorised.access, [personId]))) {
    return { status: 'error', message: t('personNotFound') };
  }

  const x = fraction(form, 'x');
  const y = fraction(form, 'y');
  const width = fraction(form, 'width');
  const height = fraction(form, 'height');
  const region =
    x !== null && y !== null && width !== null && height !== null ? { x, y, width, height } : null;

  try {
    await tagPersonInMedia(
      db,
      mediaId,
      { personId, region, note: text(form, 'note') },
      authorised.context,
    );
  } catch (error) {
    if (error instanceof ZodError) return { status: 'error', message: t('badRegion') };
    if (error instanceof MediaNotFound) return { status: 'error', message: t('notFound') };
    throw error;
  }
  revalidateTree(treeSlug);
  return { status: 'success', message: t('tagged') };
}

export async function untagPersonAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions.media');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'contribute');
  if ('error' in authorised) return authorised.error;

  const mediaId = text(form, 'mediaId');
  const personId = text(form, 'personId');
  if (!isUuid(mediaId) || !isUuid(personId) || !(await loadPhoto(treeSlug, mediaId))) {
    return { status: 'error', message: t('notFound') };
  }
  try {
    await untagPersonInMedia(db, mediaId, personId, authorised.context);
  } catch (error) {
    if (error instanceof MediaNotFound) return { status: 'error', message: t('notFound') };
    throw error;
  }
  revalidateTree(treeSlug);
  return { status: 'success', message: t('untagged') };
}

export async function updateMediaAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions.media');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'contribute');
  if ('error' in authorised) return authorised.error;

  const mediaId = text(form, 'mediaId');
  if (!isUuid(mediaId) || !(await loadPhoto(treeSlug, mediaId))) {
    return { status: 'error', message: t('notFound') };
  }
  try {
    await updateMediaDetails(
      db,
      mediaId,
      {
        title: text(form, 'title'),
        description: text(form, 'description'),
        captured: text(form, 'captured'),
        copyright: text(form, 'copyright'),
      },
      authorised.context,
    );
  } catch (error) {
    if (error instanceof ZodError) return { status: 'error', message: t('invalid') };
    if (error instanceof MediaNotFound) return { status: 'error', message: t('notFound') };
    throw error;
  }
  revalidateTree(treeSlug);
  return { status: 'success', message: t('saved') };
}

export async function saveTranscriptionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions.media');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'contribute');
  if ('error' in authorised) return authorised.error;

  const documentId = text(form, 'documentId');
  // A RESTRICTED document is for administrators: an editor who cannot open
  // it cannot rewrite it either.
  if (!isUuid(documentId) || !(await loadDocumentView(treeSlug, documentId))) {
    return { status: 'error', message: t('documentNotFound') };
  }
  const value = form.get('transcription');
  try {
    await updateDocumentTranscription(
      db,
      documentId,
      { transcription: typeof value === 'string' ? value : '' },
      authorised.context,
    );
  } catch (error) {
    if (error instanceof ZodError) return { status: 'error', message: t('transcriptionTooLong') };
    if (error instanceof MediaNotFound) return { status: 'error', message: t('documentNotFound') };
    throw error;
  }
  revalidateTree(treeSlug);
  return { status: 'success', message: t('transcriptionSaved') };
}
