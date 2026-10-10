'use server';

import { getTranslations } from 'next-intl/server';
import { ZodError } from 'zod';
import { createResearchTask, ResearchTaskNotFound, updateResearchTask } from '@chronolignee/db';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ids';
import type { ActionState } from './action-state';
import { authoriseWrite, peopleWritable } from './authorise';
import { revalidateTree } from './revalidate';

/**
 * Opening a research question, and moving it along.
 *
 * Contributors may do both: a task changes no fact about anyone, it records
 * what the family is looking for. The person a task is about goes through the
 * same visibility check as any other write naming a person.
 */

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

/** Field errors as sentences, from the codes the schema emits. */
async function fieldErrors(error: ZodError): Promise<Record<string, string>> {
  const t = await getTranslations('research.form.errors');
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form');
    if (errors[field]) continue;
    errors[field] =
      issue.message === 'UNREADABLE_DATE'
        ? t('date')
        : issue.message === 'PERIOD_REVERSED'
          ? t('period')
          : issue.message === 'URL_SCHEME'
            ? t('url')
            : field === 'title'
              ? t('title')
              : t('generic');
  }
  return errors;
}

export async function createResearchTaskAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions.research');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'contribute');
  if ('error' in authorised) return authorised.error;

  const personId = text(form, 'personId');
  if (personId && !(isUuid(personId) && (await peopleWritable(authorised.access, [personId])))) {
    return { status: 'error', fieldErrors: { personId: t('personNotFound') } };
  }

  try {
    await createResearchTask(
      db,
      {
        title: text(form, 'title'),
        hypothesis: text(form, 'hypothesis'),
        personId: personId || null,
        priority: text(form, 'priority') || 'NORMAL',
        repository: text(form, 'repository'),
        callNumber: text(form, 'callNumber'),
        placeLabel: text(form, 'placeLabel'),
        url: text(form, 'url'),
        searchFrom: text(form, 'searchFrom'),
        searchTo: text(form, 'searchTo'),
      },
      authorised.context,
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return { status: 'error', message: t('invalid'), fieldErrors: await fieldErrors(error) };
    }
    if (error instanceof ResearchTaskNotFound) {
      return { status: 'error', fieldErrors: { personId: t('personNotFound') } };
    }
    throw error;
  }

  revalidateTree(treeSlug);
  return { status: 'success', message: t('created') };
}

export async function updateResearchTaskAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions.research');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'contribute');
  if ('error' in authorised) return authorised.error;

  const taskId = text(form, 'taskId');
  if (!isUuid(taskId)) return { status: 'error', message: t('notFound') };

  try {
    await updateResearchTask(
      db,
      taskId,
      { status: text(form, 'status'), outcome: text(form, 'outcome') },
      authorised.context,
    );
  } catch (error) {
    if (error instanceof ZodError) return { status: 'error', message: t('invalid') };
    if (error instanceof ResearchTaskNotFound) return { status: 'error', message: t('notFound') };
    throw error;
  }

  revalidateTree(treeSlug);
  return { status: 'success', message: t('updated') };
}
