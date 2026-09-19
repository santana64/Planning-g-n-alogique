import 'server-only';
import { cache } from 'react';
import {
  INVITABLE_ROLES,
  TREE_ROLES,
  can,
  canChangeMembership,
  canInvite,
  type TreeRole,
} from '@chronolignee/domain';
import { listMembers, listPendingInvitations } from '@chronolignee/db';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { resolveTreeAccess, type TreeAccess } from './access';

/**
 * Who belongs to a tree, as one member sees it.
 *
 * Members only: someone reading a public tree has no business knowing who
 * researches it. Among members, addresses are shown to those who manage
 * members, and to each person for their own — a cousin invited to read does
 * not need everyone else's email.
 *
 * What each control may do is computed here from the permission table, so the
 * page offers exactly what the actions will accept; the actions check again.
 */

export interface MemberView {
  readonly memberId: string;
  readonly name: string;
  readonly email: string | null;
  readonly role: TreeRole;
  readonly joinedAt: string;
  readonly isMe: boolean;
  /** Roles this viewer may give this member, the current one included. */
  readonly assignableRoles: readonly TreeRole[];
  readonly removable: boolean;
}

export interface PendingInvitationView {
  readonly invitationId: string;
  readonly email: string;
  readonly role: TreeRole;
  readonly invitedBy: string;
  readonly expiresAt: string;
  readonly revocable: boolean;
}

export interface SharingView {
  readonly access: TreeAccess & { readonly role: TreeRole };
  readonly canManage: boolean;
  readonly members: readonly MemberView[];
  readonly invitations: readonly PendingInvitationView[];
  readonly invitableRoles: readonly TreeRole[];
  /** Whether this viewer is the only owner, and so cannot leave. */
  readonly lastOwner: boolean;
}

export const loadSharing = cache(async (treeSlug: string): Promise<SharingView | null> => {
  const session = await getSession();
  if (!session) return null;
  const access = await resolveTreeAccess(treeSlug);
  if (!access || access.role === null) return null;
  const role = access.role;
  const canManage = can(role, 'manageMembers');

  const [members, invitations] = await Promise.all([
    listMembers(db, access.treeId),
    canManage ? listPendingInvitations(db, access.treeId) : Promise.resolve([]),
  ]);
  const owners = members.filter((member) => member.role === 'OWNER').length;

  return {
    access: { ...access, role },
    canManage,
    lastOwner: role === 'OWNER' && owners === 1,
    members: members.map((member) => {
      const isMe = member.userId === session.user.id;
      // The last owner's role is not offered for change at all: every other
      // choice would be refused, and a menu of refusals is not a control.
      const lastOwner = member.role === 'OWNER' && owners === 1;
      return {
        memberId: member.memberId,
        name: member.name,
        email: canManage || isMe ? member.email : null,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
        isMe,
        assignableRoles: lastOwner
          ? [member.role]
          : TREE_ROLES.filter(
              (to) => to === member.role || canChangeMembership(role, member.role, to),
            ),
        removable: !isMe && !lastOwner && canChangeMembership(role, member.role, null),
      };
    }),
    invitations: invitations.map((invitation) => ({
      invitationId: invitation.invitationId,
      email: invitation.email,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
      expiresAt: invitation.expiresAt.toISOString(),
      revocable: canChangeMembership(role, null, invitation.role),
    })),
    invitableRoles: INVITABLE_ROLES.filter((invitable) => canInvite(role, invitable)),
  };
});
