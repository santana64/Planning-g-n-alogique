'use server';

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
  type PersonWriteContext,
} from '@chronolignee/db';
import type { Finding } from '@chronolignee/genealogy';
import { db } from '@/lib/db';
import { findingMessage } from '@/lib/finding-messages';
import { getSession } from '@/lib/session';
import type { ActionState } from './action-state';
import { resolveTreeAccess } from './access';
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

/** Authorisation, from the database, for a write. */
async function authorise(
  treeSlug: string,
): Promise<{ context: PersonWriteContext } | { error: ActionState }> {
  const session = await getSession();
  if (!session) {
    return { error: { status: 'error', message: 'Connectez-vous pour modifier cet arbre.' } };
  }

  const access = await resolveTreeAccess(treeSlug);
  // A tree the viewer may not see and a tree that does not exist give the same
  // answer, so the existence of a private family archive is not leaked by the
  // difference between two error messages.
  if (!access || !access.canEdit) {
    return {
      error: {
        status: 'error',
        message: "Cet arbre n'existe pas ou ne vous est pas ouvert en écriture.",
      },
    };
  }

  return { context: { treeId: access.treeId, actorId: session.user.id } };
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
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

function warningsFrom(findings: readonly Finding[]): string[] {
  return findings.map(findingMessage);
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
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authorise(treeSlug);
  if ('error' in authorised) return authorised.error;

  const input = {
    recordedSex: (text(form, 'recordedSex') || 'UNKNOWN') as CreatePersonInput['recordedSex'],
    livingStatus: (text(form, 'livingStatus') || 'UNKNOWN') as CreatePersonInput['livingStatus'],
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
      message: 'Indiquez au moins un nom.',
      fieldErrors: { 'names.0.given': 'Un prénom ou un nom est nécessaire.' },
    };
  }

  try {
    const created = await createPerson(db, input, authorised.context);
    revalidateTree(treeSlug);
    return {
      status: 'success',
      message: `${created.displayName} a été créé.`,
      personId: created.personId,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function updatePersonAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authorise(treeSlug);
  if ('error' in authorised) return authorised.error;

  const personId = text(form, 'personId');
  const names = namesFrom(form);
  if (names.length === 0) {
    return {
      status: 'error',
      message: 'Indiquez au moins un nom.',
      fieldErrors: { 'names.0.given': 'Un prénom ou un nom est nécessaire.' },
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
    return { status: 'success', message: `${updated.displayName} a été enregistré.`, personId };
  } catch (error) {
    return failure(error);
  }
}

export async function deletePersonAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authorise(treeSlug);
  if ('error' in authorised) return authorised.error;

  try {
    await deletePerson(db, text(form, 'personId'), authorised.context);
    revalidateTree(treeSlug);
    return { status: 'success', message: 'La personne a été retirée de l’arbre.' };
  } catch (error) {
    return failure(error);
  }
}

export async function createRelationshipAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authorise(treeSlug);
  if ('error' in authorised) return authorised.error;

  try {
    const result = await createRelationship(
      db,
      {
        sourceId: text(form, 'sourceId'),
        targetId: text(form, 'targetId'),
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
      message: 'Le lien a été créé.',
      // Reported, never blocking. A mother of 58 is unusual and real; refusing
      // it would force the researcher to falsify the register to store it.
      warnings: warningsFrom(result.warnings),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteRelationshipAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authorise(treeSlug);
  if ('error' in authorised) return authorised.error;

  try {
    await deleteRelationship(db, text(form, 'relationshipId'), authorised.context);
    revalidateTree(treeSlug);
    return { status: 'success', message: 'Le lien a été supprimé.' };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Turn a thrown write into something a form can show.
 *
 * A refused relationship is the interesting case: it carries the findings that
 * caused the refusal, and those are the whole explanation. Collapsing them to
 * "erreur" would leave the user to guess which of two people is wrong.
 */
function failure(error: unknown): ActionState {
  if (error instanceof RelationshipRefused) {
    return {
      status: 'error',
      message: 'Ce lien rendrait l’arbre incohérent.',
      warnings: warningsFrom(error.findings),
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 'error',
      message: 'Certains champs sont invalides.',
      fieldErrors: fieldErrorsFrom(error),
    };
  }
  if (error instanceof Error && error.message.includes('introuvable')) {
    return { status: 'error', message: error.message };
  }
  // Nothing from the database reaches the user: a Prisma message can carry
  // column names, constraint names and fragments of other people's data.
  return { status: 'error', message: 'L’enregistrement a échoué.' };
}
