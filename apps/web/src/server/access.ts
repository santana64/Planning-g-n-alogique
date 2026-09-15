import 'server-only';
import { cache } from 'react';
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

/**
 * Apply redaction to a person's visible fields.
 *
 * The person keeps their row. Removing them would change the shape of the
 * family and make the tree a quiet lie about who exists; what disappears is
 * everything that identifies them — name, dates, places.
 *
 * With no dates there is no position, so no bar can be drawn. Rather than
 * leaving a silent empty row, the record is flagged `redacted` and the
 * timeline draws an explicit marker: "someone is here, and their details are
 * protected" is information, while a blank row is a bug.
 */
export interface RedactablePerson {
  readonly displayName: string;
  readonly isLiving: boolean;
  readonly birthLabel: string;
  readonly deathLabel: string;
  readonly earliestJdn: number | null;
  readonly latestJdn: number | null;
  readonly redacted: boolean;
}

export const REDACTED_LABEL = 'Personne vivante';

export function redactPerson<T extends RedactablePerson>(person: T, redact: boolean): T {
  if (!redact || !person.isLiving) return person;

  return {
    ...person,
    displayName: REDACTED_LABEL,
    birthLabel: '—',
    deathLabel: '—',
    earliestJdn: null,
    latestJdn: null,
    redacted: true,
  };
}
