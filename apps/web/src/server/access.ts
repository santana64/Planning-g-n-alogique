import 'server-only';
import { cache } from 'react';
import {
  dateToJdn,
  isHiddenFrom as hiddenByRule,
  privacySubjectFromColumns,
  type PrivacySubject,
} from '@chronolignee/domain';
import type { GraphPerson } from '@chronolignee/genealogy';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';

/**
 * Who may see what.
 *
 * Every read path asks this module, and it asks the database — never the URL,
 * never a prop, never the absence of a redirect. Hiding a link in the UI is
 * not authorisation; this is.
 */

export type TreeRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'CONTRIBUTOR' | 'VIEWER';

export interface TreeAccess {
  readonly treeId: string;
  readonly treeName: string;
  readonly treeSlug: string;
  /** Null for an anonymous visitor reading a public tree. */
  readonly role: TreeRole | null;
  readonly canEdit: boolean;
  /**
   * Whether living people must be redacted for this viewer.
   *
   * True for anyone who is not a member of the tree, when the tree asks for
   * it. A public genealogy that exposes the birth dates and addresses of
   * living relatives is a privacy incident, not a feature — and the people
   * concerned never agreed to be published.
   */
  readonly redactLiving: boolean;
}

const EDIT_ROLES: readonly TreeRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'CONTRIBUTOR'];

/**
 * Resolve access to a tree, or null when the viewer may not see it at all.
 *
 * Returning null rather than throwing lets the caller decide between a 404 and
 * a redirect to sign-in. A private tree returns null for a stranger, which
 * renders as "not found" — so the existence of someone's family archive is not
 * leaked by the difference between 403 and 404.
 */
export const resolveTreeAccess = cache(async (treeSlug: string): Promise<TreeAccess | null> => {
  const tree = await db.tree.findFirst({
    where: { slug: treeSlug, deletedAt: null },
    select: { id: true, name: true, slug: true, visibility: true, redactLivingPeople: true },
  });
  if (!tree) return null;

  const session = await getSession();
  const membership = session
    ? await db.treeMember.findUnique({
        where: { treeId_userId: { treeId: tree.id, userId: session.user.id } },
        select: { role: true },
      })
    : null;

  if (membership) {
    return {
      treeId: tree.id,
      treeName: tree.name,
      treeSlug: tree.slug,
      role: membership.role,
      canEdit: EDIT_ROLES.includes(membership.role),
      // Members see the family they are researching. Redaction protects the
      // tree from the outside, not its own collaborators from each other.
      redactLiving: false,
    };
  }

  if (tree.visibility === 'PRIVATE') return null;

  return {
    treeId: tree.id,
    treeName: tree.name,
    treeSlug: tree.slug,
    role: null,
    canEdit: false,
    redactLiving: tree.redactLivingPeople,
  };
});

/** Access, or a thrown 404-shaped absence. Convenience for page components. */
export async function requireTreeAccess(treeSlug: string): Promise<TreeAccess | null> {
  return resolveTreeAccess(treeSlug);
}

export { REDACTED_LABEL, redactPerson, type RedactablePerson } from './redaction';

/**
 * Whether this viewer must not see who this is.
 *
 * The single rule lives in the domain package (privacy/index.ts): the person's
 * own setting first, then the tree's rule for presumed-living people. This
 * only supplies today's date and the viewer's standing in the tree. Each
 * projection blanks its own fields; none of them decides *whether* to blank.
 */
export function isHiddenFrom(
  person: PrivacySubject,
  access: Pick<TreeAccess, 'role' | 'redactLiving'>,
): boolean {
  return hiddenByRule(person, { role: access.role, redactLiving: access.redactLiving }, todayJdn());
}

/**
 * A graph person, as the rule sees them. Anything the graph did not carry is
 * read as the most protective value.
 */
export function graphSubject(person: GraphPerson | undefined): PrivacySubject {
  return {
    livingStatus: person?.livingStatus ?? 'UNKNOWN',
    privacy: person?.privacy ?? 'INHERIT',
    birthEarliestJdn: person?.birth?.interval.earliest ?? null,
    deathRecorded: person?.deathRecorded ?? person?.isDeceased === true,
  };
}

/** Whether a person of this graph is hidden from this viewer, by id. */
export function hiddenInGraph(
  graph: { readonly people: ReadonlyMap<string, GraphPerson> },
  access: Pick<TreeAccess, 'role' | 'redactLiving'>,
): (personId: string) => boolean {
  const today = todayJdn();
  const viewer = { role: access.role, redactLiving: access.redactLiving };
  return (personId) => hiddenByRule(graphSubject(graph.people.get(personId)), viewer, today);
}

function todayJdn(): number {
  return dateToJdn(new Date());
}

export { privacySubjectFromColumns };
