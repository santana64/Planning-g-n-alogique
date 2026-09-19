/**
 * What each role in a tree may do. The single table.
 *
 * Every server action and every screen reads it. A screen that hid a button
 * without this table agreeing would be decoration; an action that checked
 * "is a member" instead of the capability would let a contributor delete what
 * they were only trusted to add.
 *
 * Roles, from the most trusted:
 *
 * - OWNER: everything, including erasing the tree;
 * - ADMIN: runs the tree — members, settings, publication, export;
 * - EDITOR: researches — adds, corrects, retires, imports;
 * - CONTRIBUTOR: adds and corrects, never removes; a relative who brings a
 *   family bible should not be able to delete a branch by mistake;
 * - VIEWER: reads the tree as its members see it, living people included.
 */

import type { PersonPrivacy } from '../privacy/index';

export type TreeRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'CONTRIBUTOR' | 'VIEWER';

export type TreeCapability =
  /** Add and correct: people, events, links, sources, citations, documents, proposals. */
  | 'contribute'
  /** Retire what exists: people, links, events, citations. */
  | 'delete'
  /** Bring in a whole GEDCOM file at once. */
  | 'import'
  /** Take the whole tree away as a file, living people included. */
  | 'export'
  /** Publish a living person, or restrict someone to the administrators. */
  | 'setPersonPrivacy'
  /** Invite, change roles, remove members. */
  | 'manageMembers'
  /** Name, description, visibility, redaction rule. */
  | 'manageTree'
  /** Erase the tree and everything in it. */
  | 'deleteTree';

const RESEARCH: readonly TreeCapability[] = ['contribute', 'delete', 'import'];
const STEWARDSHIP: readonly TreeCapability[] = [
  ...RESEARCH,
  'export',
  'setPersonPrivacy',
  'manageMembers',
  'manageTree',
];

const CAPABILITIES: Record<TreeRole, ReadonlySet<TreeCapability>> = {
  OWNER: new Set([...STEWARDSHIP, 'deleteTree']),
  ADMIN: new Set(STEWARDSHIP),
  EDITOR: new Set(RESEARCH),
  CONTRIBUTOR: new Set(['contribute']),
  VIEWER: new Set(),
};

/** Null is someone outside the tree, who may do nothing but read what it publishes. */
export function can(role: TreeRole | null, capability: TreeCapability): boolean {
  return role !== null && CAPABILITIES[role].has(capability);
}

const RANK: Record<TreeRole, number> = {
  VIEWER: 0,
  CONTRIBUTOR: 1,
  EDITOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

/** Every role, most trusted first. */
export const TREE_ROLES: readonly TreeRole[] = [
  'OWNER',
  'ADMIN',
  'EDITOR',
  'CONTRIBUTOR',
  'VIEWER',
];

/**
 * The roles an invitation can carry.
 *
 * Never OWNER. An invitation is a link, and links get forwarded; ownership is
 * given to someone already in the tree, by an owner, deliberately.
 */
export const INVITABLE_ROLES: readonly TreeRole[] = ['ADMIN', 'EDITOR', 'CONTRIBUTOR', 'VIEWER'];

/**
 * Whether `actor` may move a member from `from` to `to`: `from` null is adding
 * someone, `to` null is removing them.
 *
 * Owners may do anything but leave the tree without an owner, which the caller
 * checks against the members themselves because it is a fact about the tree,
 * not about roles. Administrators manage the roles below their own: one who
 * could create administrators could create peers to outvote the owner, and
 * one who could demote another could lock them out.
 *
 * Leaving a tree is not this question: anyone may remove themselves, as long
 * as an owner remains.
 */
export function canChangeMembership(
  actor: TreeRole | null,
  from: TreeRole | null,
  to: TreeRole | null,
): boolean {
  if (actor === null || !can(actor, 'manageMembers')) return false;
  if (from === null && to === null) return false;
  if (actor === 'OWNER') return true;
  const below = (role: TreeRole | null) => role === null || RANK[role] < RANK[actor];
  return below(from) && below(to);
}

/** Whether `actor` may send an invitation carrying `role`. */
export function canInvite(actor: TreeRole | null, role: TreeRole): boolean {
  return INVITABLE_ROLES.includes(role) && canChangeMembership(actor, null, role);
}

/**
 * The settings that reach beyond the tree's own rule.
 *
 * VISIBLE publishes a person the rule would hide — a living person, on a
 * public tree. RESTRICTED hides someone from the tree's own editors. Both are
 * decisions about other people's exposure, so both belong to the people who
 * run the tree; INHERIT and REDACTED only ever follow or tighten the rule.
 */
const STEWARD_PRIVACY: ReadonlySet<PersonPrivacy> = new Set(['VISIBLE', 'RESTRICTED']);

export function canSetPersonPrivacy(
  role: TreeRole | null,
  from: PersonPrivacy,
  to: PersonPrivacy,
): boolean {
  if (!can(role, 'contribute')) return false;
  if (from === to) return true;
  if (STEWARD_PRIVACY.has(from) || STEWARD_PRIVACY.has(to)) return can(role, 'setPersonPrivacy');
  return true;
}
