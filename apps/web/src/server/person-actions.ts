'use server';

import { getLocale, getTranslations } from 'next-intl/server';
import { ZodError } from 'zod';
import {
  RelationshipRefused,
  createPerson,
  createRelationship,
  deletePerson,
  deleteRelationship,
  updatePerson,
  type CreatePersonInput,
  type PersonNameInput,
} from '@chronolignee/db';
import {
  PERSON_PRIVACY_LEVELS,
  canSetPersonPrivacy,
  defaultPersonPrivacy,
  type PersonPrivacy,
} from '@chronolignee/domain';
import type { Finding } from '@chronolignee/genealogy';
import { redirect } from '@/i18n/navigation';
import { db } from '@/lib/db';
import { findingMessage } from '@/lib/finding-messages';
import type { ActionState } from './action-state';
import {
  notFound,
  authoriseWrite,
  peopleOfRelationship,
  peopleWritable,
  refusal,
} from './authorise';
import { revalidateTree } from './revalidate';
import { listPeople, type PersonSummary } from './people';

/**
 * Every mutation the editing screens can perform.
 *
 * Each one re-checks authorisation against the database before it writes.
 * Not because the UI is careless, but because a Server Action is a public
 * HTTP endpoint with a generated name: anyone can POST to it, whether or not
 * a button was ever rendered for them. The button is a convenience; this is
 * the boundary.
 *
 * Errors come back as state rather than as thrown exceptions, because the
 * failure a user actually meets — "this date makes them their own ancestor" —
 * is information they need in the form, not a crash page.
 */

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** The privacy setting submitted, or undefined when absent or not a setting at all. */
function privacyFrom(form: FormData): PersonPrivacy | undefined {
  const value = text(form, 'privacy');
  return (PERSON_PRIVACY_LEVELS as readonly string[]).includes(value)
    ? (value as PersonPrivacy)
    : undefined;
}

/**
 * The names submitted by the form.
 *
 * Indexed field names (`names.0.given`) rather than JSON, so the form still
 * works before hydration and so a malformed row fails validation in Zod
 * instead of at JSON.parse.
 */
function namesFrom(form: FormData): PersonNameInput[] {
  const names: PersonNameInput[] = [];
  for (let index = 0; index < 12; index += 1) {
    const given = text(form, `names.${index}.given`);
    const surname = text(form, `names.${index}.surname`);
    const nickname = text(form, `names.${index}.nickname`);
    if (!given && !surname && !nickname) continue;

    names.push({
      type: (text(form, `names.${index}.type`) || 'BIRTH') as PersonNameInput['type'],
      given,
      surname,
      surnamePrefix: text(form, `names.${index}.surnamePrefix`),
      nickname,
      isPreferred: index === 0,
      confidence: (text(form, `names.${index}.confidence`) ||
        'MEDIUM') as PersonNameInput['confidence'],
    });
  }
  return names;
}

function fieldErrorsFrom(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    errors[path || 'form'] ??= issue.message;
  }
  return errors;
}

async function warningsFrom(findings: readonly Finding[]): Promise<string[]> {
  if (findings.length === 0) return [];
  const t = await getTranslations('findings');
  return findings.map((finding) => findingMessage(t, finding));
}

/**
 * Name lookup for the relationship editor.
 *
 * A select listing every person does not survive a tree of twenty thousand,
 * and a select listing the first sixty silently cannot link to the rest. This
 * asks the server, which already knows how to fold a query the same way the
 * stored name was folded.
 *
 * Redaction applies: a stranger must not be able to enumerate living people
 * by typing letters into a combobox.
 */
export async function searchPeopleAction(
  treeSlug: string,
  query: string,
): Promise<readonly PersonSummary[]> {
  const listing = await listPeople(treeSlug, query);
  if (!listing) return [];
  return listing.people.slice(0, 20);
}

export async function createPersonAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  const livingStatus = (text(form, 'livingStatus') ||
    'UNKNOWN') as CreatePersonInput['livingStatus'] & string;
  // Checked against what the person would start with anyway: choosing the
  // default is not a decision that needs an administrator.
  const privacy = privacyFrom(form);
  if (
    privacy &&
    !canSetPersonPrivacy(authorised.access.role, defaultPersonPrivacy(livingStatus), privacy)
  ) {
    return refusal('setPersonPrivacy');
  }

  const input = {
    recordedSex: (text(form, 'recordedSex') || 'UNKNOWN') as CreatePersonInput['recordedSex'],
    livingStatus,
    ...(privacy ? { privacy } : {}),
    names: namesFrom(form),
    notes: text(form, 'notes'),
    birthDate: text(form, 'birthDate'),
    birthPlace: text(form, 'birthPlace'),
    deathDate: text(form, 'deathDate'),
    deathPlace: text(form, 'deathPlace'),
  };

  if (input.names.length === 0) {
    return {
      status: 'error',
      message: t('person.nameRequired'),
      fieldErrors: { 'names.0.given': t('person.nameFieldRequired') },
    };
  }

  try {
    const created = await createPerson(db, input, authorised.context);
    revalidateTree(treeSlug);
    return {
      status: 'success',
      message: t('person.created', { name: created.displayName }),
      personId: created.personId,
    };
  } catch (error) {
    return await failure(error);
  }
}

export async function updatePersonAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  const personId = text(form, 'personId');
  if (!(await peopleWritable(authorised.access, [personId]))) return await notFound();

  const privacy = privacyFrom(form);
  if (privacy) {
    const current = await db.person.findFirst({
      where: { id: personId, treeId: authorised.access.treeId, deletedAt: null },
      select: { privacy: true },
    });
    if (!current) return await notFound();
    if (!canSetPersonPrivacy(authorised.access.role, current.privacy, privacy)) {
      return refusal('setPersonPrivacy');
    }
  }

  const names = namesFrom(form);
  if (names.length === 0) {
    return {
      status: 'error',
      message: t('person.nameRequired'),
      fieldErrors: { 'names.0.given': t('person.nameFieldRequired') },
    };
  }

  try {
    const updated = await updatePerson(
      db,
      {
        personId,
        recordedSex: (text(form, 'recordedSex') || 'UNKNOWN') as CreatePersonInput['recordedSex'],
        livingStatus: (text(form, 'livingStatus') ||
          'UNKNOWN') as CreatePersonInput['livingStatus'],
        ...(privacy ? { privacy } : {}),
        names,
        notes: text(form, 'notes'),
        birthDate: text(form, 'birthDate'),
        birthPlace: text(form, 'birthPlace'),
        deathDate: text(form, 'deathDate'),
        deathPlace: text(form, 'deathPlace'),
      },
      authorised.context,
    );
    revalidateTree(treeSlug);
    return {
      status: 'success',
      message: t('person.saved', { name: updated.displayName }),
      personId,
    };
  } catch (error) {
    return await failure(error);
  }
}

export async function deletePersonAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'delete');
  if ('error' in authorised) return authorised.error;

  const personId = text(form, 'personId');
  if (!(await peopleWritable(authorised.access, [personId]))) return await notFound();

  try {
    await deletePerson(db, personId, authorised.context);
  } catch (error) {
    return await failure(error);
  }
  revalidateTree(treeSlug);
  // From the server, in the same response. Left to the client, the
  // revalidated record page — whose person no longer exists — rendered a 404
  // before the client got round to leaving it.
  redirect({ href: `/app/${treeSlug}/personnes`, locale: await getLocale() });
  // Not reached: redirect throws. Typed as returning, so said explicitly.
  return { status: 'success' };
}

export async function createRelationshipAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  const sourceId = text(form, 'sourceId');
  const targetId = text(form, 'targetId');
  if (!(await peopleWritable(authorised.access, [sourceId, targetId]))) return await notFound();

  try {
    const result = await createRelationship(
      db,
      {
        sourceId,
        targetId,
        type: text(form, 'type') as 'PARENT_BIOLOGICAL',
        startDate: text(form, 'startDate'),
        endDate: text(form, 'endDate'),
        confidence: (text(form, 'confidence') || 'MEDIUM') as 'MEDIUM',
        notes: '',
      },
      authorised.context,
    );
    revalidateTree(treeSlug);

    return {
      status: 'success',
      message: t('person.linkCreated'),
      // Reported, never blocking. A mother of 58 is unusual and real; refusing
      // it would force the researcher to falsify the register to store it.
      warnings: await warningsFrom(result.warnings),
    };
  } catch (error) {
    return await failure(error);
  }
}

export async function deleteRelationshipAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'delete');
  if ('error' in authorised) return authorised.error;

  const relationshipId = text(form, 'relationshipId');
  const people = await peopleOfRelationship(authorised.access.treeId, relationshipId);
  if (!people || !(await peopleWritable(authorised.access, people))) return await notFound();

  try {
    await deleteRelationship(db, relationshipId, authorised.context);
    revalidateTree(treeSlug);
    return { status: 'success', message: t('person.linkDeleted') };
  } catch (error) {
    return await failure(error);
  }
}

/**
 * Turn a thrown write into something a form can show.
 *
 * A refused relationship is the interesting case: it carries the findings that
 * caused the refusal, and those are the whole explanation. Collapsing them to
 * "erreur" would leave the user to guess which of two people is wrong.
 */
async function failure(error: unknown): Promise<ActionState> {
  const t = await getTranslations('actions');
  if (error instanceof RelationshipRefused) {
    return {
      status: 'error',
      message: t('person.linkInconsistent'),
      warnings: await warningsFrom(error.findings),
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 'error',
      message: t('invalidFields'),
      fieldErrors: fieldErrorsFrom(error),
    };
  }
  if (error instanceof Error && error.message.includes('introuvable')) {
    return { status: 'error', message: error.message };
  }
  // Nothing from the database reaches the user: a Prisma message can carry
  // column names, constraint names and fragments of other people's data.
  return { status: 'error', message: t('person.writeFailed') };
}
