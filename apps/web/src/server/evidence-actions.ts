'use server';

import { getTranslations } from 'next-intl/server';
import { ZodError } from 'zod';
import {
  createCitation,
  createSource,
  deleteCitation,
  type CreateCitationInput,
  type CreateSourceInput,
} from '@chronolignee/db';
import { db } from '@/lib/db';
import type { ActionState } from './action-state';
import { resolveTreeAccess } from './access';
import {
  notFound,
  authoriseWrite,
  peopleOfCitation,
  peopleOfEvent,
  peopleWritable,
} from './authorise';
import { revalidateTree } from './revalidate';

/**
 * Sources and citations.
 *
 * Same boundary as every other mutation: authorisation is re-checked against
 * the database, because a Server Action is a public endpoint whatever the UI
 * chose to render.
 */

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

async function failure(error: unknown): Promise<ActionState> {
  const t = await getTranslations('actions');
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return { status: 'error', message: issue?.message ?? t('invalidFields') };
  }
  if (error instanceof Error && /introuvable|No Source|No Event|No Document/.test(error.message)) {
    return { status: 'error', message: t('evidence.notFound') };
  }
  // Nothing from the database reaches the user: a Prisma message can carry
  // column names, constraint names and fragments of other people's data.
  return { status: 'error', message: t('evidence.writeFailed') };
}

export async function createSourceAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  try {
    await createSource(
      db,
      {
        title: text(form, 'title'),
        type: (text(form, 'type') || 'OTHER') as CreateSourceInput['type'],
        author: text(form, 'author'),
        repository: text(form, 'repository'),
        callNumber: text(form, 'callNumber'),
        url: text(form, 'url'),
        publishedAt: text(form, 'publishedAt'),
        reliability: (text(form, 'reliability') || 'MEDIUM') as CreateSourceInput['reliability'],
        notes: text(form, 'notes'),
      },
      authorised.context,
    );
    revalidateTree(treeSlug);
    return { status: 'success', message: t('evidence.sourceAdded') };
  } catch (error) {
    return await failure(error);
  }
}

export async function createCitationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  const eventId = text(form, 'eventId');
  const documentId = text(form, 'documentId');
  if (eventId) {
    const people = await peopleOfEvent(authorised.access.treeId, eventId);
    if (!people || !(await peopleWritable(authorised.access, people))) return await notFound();
  }

  try {
    await createCitation(
      db,
      {
        sourceId: text(form, 'sourceId'),
        locator: text(form, 'locator'),
        page: text(form, 'page'),
        volume: text(form, 'volume'),
        quotation: text(form, 'quotation'),
        confidence: (text(form, 'confidence') || 'MEDIUM') as CreateCitationInput['confidence'],
        ...(eventId ? { eventId } : {}),
        ...(documentId ? { documentId } : {}),
      },
      authorised.context,
    );
    revalidateTree(treeSlug);
    return { status: 'success', message: t('evidence.citationSaved') };
  } catch (error) {
    return await failure(error);
  }
}

export async function deleteCitationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'delete');
  if ('error' in authorised) return authorised.error;

  const citationId = text(form, 'citationId');
  const people = await peopleOfCitation(authorised.access.treeId, citationId);
  if (!people || !(await peopleWritable(authorised.access, people))) return await notFound();

  try {
    await deleteCitation(db, citationId, authorised.context);
    revalidateTree(treeSlug);
    return { status: 'success', message: t('evidence.citationRemoved') };
  } catch (error) {
    return await failure(error);
  }
}

export interface SourceChoice {
  readonly sourceId: string;
  readonly title: string;
  readonly callNumber: string | null;
}

/** The sources a citation form can point at. */
export async function listSourcesAction(treeSlug: string): Promise<readonly SourceChoice[]> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return [];

  const sources = await db.source.findMany({
    where: { treeId: access.treeId, deletedAt: null },
    select: { id: true, title: true, callNumber: true },
    orderBy: [{ citations: { _count: 'desc' } }, { title: 'asc' }],
    take: 200,
  });

  return sources.map((source) => ({
    sourceId: source.id,
    title: source.title,
    callNumber: source.callNumber,
  }));
}
