'use server';

import { getTranslations } from 'next-intl/server';
import { ZodError } from 'zod';
import {
  RelationshipRefused,
  createEvent,
  createRelationship,
  deleteEvent,
  updateEvent,
  type CreateEventInput,
} from '@chronolignee/db';
import { findingMessage } from '@/lib/finding-messages';
import { db } from '@/lib/db';
import type { ActionState } from './action-state';
import { notFound, authoriseWrite, peopleOfEvent, peopleWritable } from './authorise';
import { revalidateTree } from './revalidate';

/**
 * Events other than birth and death.
 *
 * Same boundary as every other mutation: authorisation is re-checked against
 * the database here, because a Server Action is a public endpoint and the
 * button that renders it is a convenience rather than a permission.
 */

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** The structural link each union event implies, when the user asks for it. */
const UNION_LINK: Partial<Record<string, 'SPOUSE' | 'PARTNER' | 'DIVORCED_PARTNER'>> = {
  MARRIAGE: 'SPOUSE',
  MARRIAGE_CONTRACT: 'SPOUSE',
  MARRIAGE_BANN: 'SPOUSE',
  CIVIL_UNION: 'PARTNER',
  DIVORCE: 'DIVORCED_PARTNER',
};

async function failure(error: unknown): Promise<ActionState> {
  const t = await getTranslations('actions');
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return { status: 'error', message: issue?.message ?? t('invalidFields') };
  }
  if (error instanceof Error && error.message.includes('introuvable')) {
    return { status: 'error', message: error.message };
  }
  // Nothing from the database reaches the user: a Prisma message can carry
  // column names, constraint names and fragments of other people's data.
  return { status: 'error', message: t('event.writeFailed') };
}

export async function createEventAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  const personId = text(form, 'personId');
  const secondId = text(form, 'secondId');
  if (!(await peopleWritable(authorised.access, [personId, secondId]))) return await notFound();

  const participants: CreateEventInput['participants'] = [
    { personId, role: text(form, 'role') || 'PRINCIPAL' },
    // A marriage belongs to two people. Storing it on one of them would make
    // the same event appear twice with two dates that drift apart.
    ...(secondId ? [{ personId: secondId, role: text(form, 'secondRole') || 'SPOUSE' }] : []),
  ] as CreateEventInput['participants'];

  const type = text(form, 'type') as CreateEventInput['type'];
  const date = text(form, 'date');

  try {
    await createEvent(
      db,
      {
        type,
        customType: text(form, 'customType'),
        date,
        placeName: text(form, 'placeName'),
        description: text(form, 'description'),
        confidence: (text(form, 'confidence') || 'MEDIUM') as CreateEventInput['confidence'],
        participants,
      },
      authorised.context,
    );

    // A marriage event and a spouse link are different things in this model:
    // one is a dated record, the other is the structure the graph walks. A
    // researcher recording a marriage almost always wants both — but deriving
    // the second from the first without asking is the software deciding what
    // the record means, so the form asks and this only obeys.
    const warnings: string[] = [];
    if (secondId && form.get('alsoLink') !== null) {
      const linkType = UNION_LINK[type];
      if (linkType) {
        try {
          const link = await createRelationship(
            db,
            {
              sourceId: personId,
              targetId: secondId,
              type: linkType,
              startDate: linkType === 'DIVORCED_PARTNER' ? '' : date,
              endDate: '',
              confidence: 'MEDIUM',
              notes: '',
            },
            authorised.context,
          );
          const findings = await getTranslations('findings');
          warnings.push(...link.warnings.map((finding) => findingMessage(findings, finding)));
        } catch (linkError) {
          // The event is already written and is the thing the user asked for.
          // A refused link is reported, never a reason to lose the record.
          const findings = await getTranslations('findings');
          warnings.push(
            linkError instanceof RelationshipRefused
              ? t('event.unionLinkFailed') +
                  linkError.findings.map((finding) => findingMessage(findings, finding)).join(' ')
              : t('event.unionLinkRefused'),
          );
        }
      }
    }

    revalidateTree(treeSlug);
    return {
      status: 'success',
      message: t('event.added'),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    return await failure(error);
  }
}

export async function updateEventAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  const eventId = text(form, 'eventId');
  const people = await peopleOfEvent(authorised.access.treeId, eventId);
  if (!people || !(await peopleWritable(authorised.access, people))) return await notFound();

  try {
    await updateEvent(
      db,
      {
        eventId,
        date: text(form, 'date'),
        placeName: text(form, 'placeName'),
        description: text(form, 'description'),
      },
      authorised.context,
    );
    revalidateTree(treeSlug);
    return { status: 'success', message: t('event.corrected') };
  } catch (error) {
    return await failure(error);
  }
}

export async function deleteEventAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'delete');
  if ('error' in authorised) return authorised.error;

  const eventId = text(form, 'eventId');
  const people = await peopleOfEvent(authorised.access.treeId, eventId);
  if (!people || !(await peopleWritable(authorised.access, people))) return await notFound();

  try {
    await deleteEvent(db, eventId, authorised.context);
    revalidateTree(treeSlug);
    return { status: 'success', message: t('event.removed') };
  } catch (error) {
    return await failure(error);
  }
}
