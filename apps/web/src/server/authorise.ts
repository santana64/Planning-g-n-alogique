import 'server-only';
import { can, type TreeCapability, type TreeRole } from '@chronolignee/domain';
import type { PersonWriteContext } from '@chronolignee/db';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ids';
import { getSession } from '@/lib/session';
import type { ActionState } from './action-state';
import {
  isHiddenFrom,
  privacySubjectFromColumns,
  resolveTreeAccess,
  type TreeAccess,
} from './access';

/**
 * The boundary every write crosses.
 *
 * A Server Action is a public HTTP endpoint with a generated name: anyone can
 * POST to it, whether or not a button was ever rendered for them. So each
 * write names the capability it needs, and this answers from the database —
 * the session, the membership, the role, the permission table — before the
 * write runs. The button is a convenience; this is the permission.
 */

export interface WriteGrant {
  readonly access: TreeAccess & { readonly role: TreeRole };
  readonly context: PersonWriteContext;
  /** The signed-in account. */
  readonly userId: string;
}

export type WriteAuthorisation = WriteGrant | { readonly error: ActionState };

/**
 * What a member is told when their role does not allow the write.
 *
 * Said plainly: they know the tree exists and what their role is, and "an
 * error occurred" would send them looking for a bug.
 */
const REFUSED: Record<TreeCapability, string> = {
  contribute: 'Vous consultez cet arbre en lecture seule.',
  delete: 'Votre rôle dans cet arbre permet d’ajouter et de corriger, pas de supprimer.',
  import: 'Votre rôle dans cet arbre ne permet pas d’importer un fichier.',
  export: 'Seuls le propriétaire et les administrateurs peuvent exporter l’arbre.',
  setPersonPrivacy:
    'Seuls le propriétaire et les administrateurs peuvent publier ou restreindre une personne.',
  manageMembers: 'Seuls le propriétaire et les administrateurs gèrent les membres.',
  manageTree: 'Seuls le propriétaire et les administrateurs modifient les réglages de l’arbre.',
  deleteTree: 'Seul le propriétaire peut supprimer l’arbre.',
};

export function refusal(capability: TreeCapability): ActionState {
  return { status: 'error', message: REFUSED[capability] };
}

/** Said for a record that does not exist and for one this author may not see alike. */
export const NOT_FOUND: ActionState = {
  status: 'error',
  message: 'Cette fiche est introuvable dans cet arbre.',
};

export async function authoriseWrite(
  treeSlug: string,
  capability: TreeCapability = 'contribute',
): Promise<WriteAuthorisation> {
  const session = await getSession();
  if (!session) {
    return { error: { status: 'error', message: 'Connectez-vous pour modifier cet arbre.' } };
  }

  const access = await resolveTreeAccess(treeSlug);
  // A tree the author may not see, a public tree they are not a member of,
  // and a tree that does not exist give the same answer: the existence of a
  // private family archive is not leaked by the difference between messages.
  if (!access || access.role === null) {
    return {
      error: {
        status: 'error',
        message: "Cet arbre n'existe pas ou ne vous est pas ouvert en écriture.",
      },
    };
  }
  if (!can(access.role, capability)) return { error: refusal(capability) };

  return {
    access: { ...access, role: access.role },
    context: { treeId: access.treeId, actorId: session.user.id },
    userId: session.user.id,
  };
}

/**
 * Whether every one of these people exists in the tree and is visible to the
 * author.
 *
 * A restricted person is hidden from the tree's editors. An action naming
 * them — from a crafted request, or a page opened before the restriction —
 * must fail exactly as it would for someone who does not exist, or the
 * refusal itself would confirm them.
 */
export async function peopleWritable(
  access: Pick<TreeAccess, 'treeId' | 'role' | 'redactLiving'>,
  personIds: readonly (string | null | undefined)[],
): Promise<boolean> {
  const unique = [...new Set(personIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return true;
  if (!unique.every((id) => isUuid(id))) return false;

  const rows = await db.person.findMany({
    where: { id: { in: unique }, treeId: access.treeId, deletedAt: null },
    select: {
      livingStatus: true,
      privacy: true,
      lifespanEarliestJdn: true,
      lifespanLatestJdn: true,
      lifespanLatestInferred: true,
    },
  });
  return (
    rows.length === unique.length &&
    rows.every((row) => !isHiddenFrom(privacySubjectFromColumns(row), access))
  );
}

/** The people an event concerns; null when it is not in this tree. */
export async function peopleOfEvent(treeId: string, eventId: string): Promise<string[] | null> {
  if (!isUuid(eventId)) return null;
  const event = await db.event.findFirst({
    where: { id: eventId, treeId, deletedAt: null },
    select: { participants: { select: { personId: true } } },
  });
  return event ? event.participants.map((participant) => participant.personId) : null;
}

/** The two people a link joins; null when it is not in this tree. */
export async function peopleOfRelationship(
  treeId: string,
  relationshipId: string,
): Promise<string[] | null> {
  if (!isUuid(relationshipId)) return null;
  const relationship = await db.relationship.findFirst({
    where: { id: relationshipId, treeId, deletedAt: null },
    select: { sourceId: true, targetId: true },
  });
  return relationship ? [relationship.sourceId, relationship.targetId] : null;
}

/**
 * The people a citation speaks about: through the event it supports and the
 * claims it backs. Null when it is not in this tree.
 */
export async function peopleOfCitation(
  treeId: string,
  citationId: string,
): Promise<string[] | null> {
  if (!isUuid(citationId)) return null;
  const citation = await db.citation.findFirst({
    where: { id: citationId, treeId },
    select: {
      event: { select: { participants: { select: { personId: true } } } },
      claims: { select: { claim: { select: { personId: true } } } },
    },
  });
  if (!citation) return null;
  return [
    ...(citation.event?.participants.map((participant) => participant.personId) ?? []),
    ...citation.claims.flatMap((link) => (link.claim.personId ? [link.claim.personId] : [])),
  ];
}

/**
 * The people a machine proposal concerns: the one it names, and those of the
 * citation it was read from. Null when it is not in this tree.
 */
export async function peopleOfProposal(
  treeId: string,
  proposalId: string,
): Promise<string[] | null> {
  if (!isUuid(proposalId)) return null;
  const proposal = await db.aiProposal.findFirst({
    where: { id: proposalId, treeId },
    select: { personId: true, citationId: true },
  });
  if (!proposal) return null;
  const fromCitation = proposal.citationId
    ? ((await peopleOfCitation(treeId, proposal.citationId)) ?? [])
    : [];
  return [...(proposal.personId ? [proposal.personId] : []), ...fromCitation];
}
