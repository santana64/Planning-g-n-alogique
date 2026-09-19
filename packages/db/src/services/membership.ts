import { createHash, randomBytes } from 'node:crypto';
import { canChangeMembership, canInvite, type TreeRole } from '@chronolignee/domain';
import { sql } from '../../generated/client/internal/prismaNamespace';
import type { Database } from '../client';
import { recordRevision } from './audit';

/**
 * Who belongs to a tree, and how someone new comes in.
 *
 * Every rule about who may change whose role is the permission table's
 * (`canChangeMembership`); what this adds is what only the database can know:
 * whether the tree would be left without an owner, whether an invitation is
 * still good, whether two people acted at once.
 *
 * Invitations are links. There is no mail provider on a self-hosted instance
 * by default, so the inviter receives the link once and passes it on; only a
 * hash of it is stored, and it works once, for one address, for a week.
 *
 * The history records members by account id, never by name: a name written
 * into a revision would outlive the erasure of the account it belonged to.
 * The history page puts the name back while the account exists.
 */

export type MembershipRefusal =
  | 'NOT_ALLOWED'
  | 'LAST_OWNER'
  | 'NOT_FOUND'
  | 'ALREADY_MEMBER'
  | 'INVALID_EMAIL'
  | 'EXPIRED'
  | 'REVOKED'
  | 'USED'
  | 'WRONG_ACCOUNT';

export class MembershipRefused extends Error {
  constructor(readonly code: MembershipRefusal) {
    super(code);
    this.name = 'MembershipRefused';
  }
}

/**
 * Who is acting.
 *
 * Their role is read inside the transaction, after the lock, never taken
 * from the caller: an owner demoted a second ago must not act with the role
 * their request was authorised under.
 */
export interface MembershipActor {
  readonly userId: string;
}

export const INVITATION_TTL_DAYS = 7;

export const ROLE_LABELS: Record<TreeRole, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  EDITOR: 'Éditeur',
  CONTRIBUTOR: 'Contributeur',
  VIEWER: 'Lecteur',
};

const ROLE_ORDER: Record<TreeRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  EDITOR: 2,
  CONTRIBUTOR: 3,
  VIEWER: 4,
};

/** Deliberately loose: the address is checked by whoever receives the link. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Tx = Parameters<Parameters<Database['$transaction']>[0]>[0];

/** Only this reaches the database. A leaked table yields no usable link. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Serialise membership changes on one tree.
 *
 * Two owners each demoting the other would both see "another owner remains"
 * and both succeed, leaving a tree nobody can administer. Locking the tree
 * row makes the second wait for the first and then see the truth.
 */
async function lockTree(tx: Tx, treeId: string): Promise<void> {
  await tx.$queryRaw(sql`SELECT 1 FROM "trees" WHERE "id" = ${treeId}::uuid FOR UPDATE`);
}

async function roleOf(tx: Tx, treeId: string, userId: string): Promise<TreeRole | null> {
  const member = await tx.treeMember.findUnique({
    where: { treeId_userId: { treeId, userId } },
    select: { role: true },
  });
  return member?.role ?? null;
}

async function assertAnotherOwner(tx: Tx, treeId: string, memberId: string): Promise<void> {
  const others = await tx.treeMember.count({
    where: { treeId, role: 'OWNER', id: { not: memberId } },
  });
  if (others === 0) throw new MembershipRefused('LAST_OWNER');
}

// --- Members ----------------------------------------------------------------

export interface MemberRow {
  readonly memberId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: TreeRole;
  readonly joinedAt: Date;
}

export async function listMembers(db: Database, treeId: string): Promise<MemberRow[]> {
  const rows = await db.treeMember.findMany({
    where: { treeId, user: { deletedAt: null } },
    select: {
      id: true,
      role: true,
      joinedAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  return rows
    .map((row) => ({
      memberId: row.id,
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: row.role,
      joinedAt: row.joinedAt,
    }))
    .sort(
      (a, b) =>
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt.getTime() - b.joinedAt.getTime(),
    );
}

export async function changeMemberRole(
  db: Database,
  input: { readonly treeId: string; readonly memberId: string; readonly role: TreeRole },
  actor: MembershipActor,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockTree(tx, input.treeId);
    const member = await tx.treeMember.findFirst({
      where: { id: input.memberId, treeId: input.treeId },
      select: { id: true, role: true, userId: true },
    });
    if (!member) throw new MembershipRefused('NOT_FOUND');
    if (member.role === input.role) return;
    const actorRole = await roleOf(tx, input.treeId, actor.userId);
    if (!canChangeMembership(actorRole, member.role, input.role)) {
      throw new MembershipRefused('NOT_ALLOWED');
    }
    if (member.role === 'OWNER') await assertAnotherOwner(tx, input.treeId, member.id);

    await tx.treeMember.update({ where: { id: member.id }, data: { role: input.role } });
    await recordRevision(tx, {
      treeId: input.treeId,
      entityType: 'TreeMember',
      entityId: member.id,
      action: 'UPDATE',
      actorId: actor.userId,
      before: { role: member.role, userId: member.userId },
      after: { role: input.role, userId: member.userId },
      summary: `Rôle modifié : ${ROLE_LABELS[member.role]} → ${ROLE_LABELS[input.role]}`,
    });
  });
}

/**
 * Remove a member, or let one leave.
 *
 * Leaving needs no permission — nobody is kept in a family archive against
 * their will — as long as an owner remains.
 */
export async function removeMember(
  db: Database,
  input: { readonly treeId: string; readonly memberId: string },
  actor: MembershipActor,
): Promise<{ readonly left: boolean }> {
  return db.$transaction(async (tx) => {
    await lockTree(tx, input.treeId);
    const member = await tx.treeMember.findFirst({
      where: { id: input.memberId, treeId: input.treeId },
      select: { id: true, role: true, userId: true },
    });
    if (!member) throw new MembershipRefused('NOT_FOUND');
    const leaving = member.userId === actor.userId;
    if (
      !leaving &&
      !canChangeMembership(await roleOf(tx, input.treeId, actor.userId), member.role, null)
    ) {
      throw new MembershipRefused('NOT_ALLOWED');
    }
    if (member.role === 'OWNER') await assertAnotherOwner(tx, input.treeId, member.id);

    await tx.treeMember.delete({ where: { id: member.id } });
    await recordRevision(tx, {
      treeId: input.treeId,
      entityType: 'TreeMember',
      entityId: member.id,
      action: 'DELETE',
      actorId: actor.userId,
      before: { role: member.role, userId: member.userId },
      summary: leaving ? 'A quitté l’arbre' : 'Retiré de l’arbre',
    });
    return { left: leaving };
  });
}

// --- Invitations ------------------------------------------------------------

export interface InvitationRow {
  readonly invitationId: string;
  readonly email: string;
  readonly role: TreeRole;
  readonly invitedBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** Invitations still waiting for an answer. */
export async function listPendingInvitations(
  db: Database,
  treeId: string,
  now: Date = new Date(),
): Promise<InvitationRow[]> {
  const rows = await db.treeInvitation.findMany({
    where: { treeId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      expiresAt: true,
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => ({
    invitationId: row.id,
    email: row.email,
    role: row.role,
    invitedBy: row.invitedBy.name,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }));
}

export interface CreatedInvitation {
  readonly invitationId: string;
  /** The only time the token exists outside the link. Never stored, never logged. */
  readonly token: string;
  readonly expiresAt: Date;
}

export async function createInvitation(
  db: Database,
  input: { readonly treeId: string; readonly email: string; readonly role: TreeRole },
  actor: MembershipActor,
  now: Date = new Date(),
): Promise<CreatedInvitation> {
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) throw new MembershipRefused('INVALID_EMAIL');

  return db.$transaction(async (tx) => {
    await lockTree(tx, input.treeId);
    if (!canInvite(await roleOf(tx, input.treeId, actor.userId), input.role)) {
      throw new MembershipRefused('NOT_ALLOWED');
    }

    const member = await tx.treeMember.findFirst({
      where: { treeId: input.treeId, user: { email } },
      select: { id: true },
    });
    if (member) throw new MembershipRefused('ALREADY_MEMBER');

    // One live invitation per address: a new one replaces the old, whose link
    // stops working — the inviter re-sending is usually correcting a role.
    await tx.treeInvitation.updateMany({
      where: { treeId: input.treeId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const invitation = await tx.treeInvitation.create({
      data: {
        treeId: input.treeId,
        email,
        role: input.role,
        tokenHash: hashInvitationToken(token),
        invitedById: actor.userId,
        expiresAt,
      },
      select: { id: true },
    });

    // The address stays out of the history: it belongs to someone who has
    // not joined, and may never.
    await recordRevision(tx, {
      treeId: input.treeId,
      entityType: 'TreeInvitation',
      entityId: invitation.id,
      action: 'CREATE',
      actorId: actor.userId,
      after: { role: input.role },
      summary: `Invitation envoyée (${ROLE_LABELS[input.role]})`,
    });

    return { invitationId: invitation.id, token, expiresAt };
  });
}

export async function revokeInvitation(
  db: Database,
  input: { readonly treeId: string; readonly invitationId: string },
  actor: MembershipActor,
  now: Date = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const invitation = await tx.treeInvitation.findFirst({
      where: { id: input.invitationId, treeId: input.treeId },
      select: { id: true, role: true, acceptedAt: true, revokedAt: true },
    });
    if (!invitation) throw new MembershipRefused('NOT_FOUND');
    const actorRole = await roleOf(tx, input.treeId, actor.userId);
    if (!canChangeMembership(actorRole, null, invitation.role)) {
      throw new MembershipRefused('NOT_ALLOWED');
    }
    if (invitation.acceptedAt || invitation.revokedAt) return;

    await tx.treeInvitation.update({ where: { id: invitation.id }, data: { revokedAt: now } });
    await recordRevision(tx, {
      treeId: input.treeId,
      entityType: 'TreeInvitation',
      entityId: invitation.id,
      action: 'UPDATE',
      actorId: actor.userId,
      after: { revoked: true },
      summary: `Invitation révoquée (${ROLE_LABELS[invitation.role]})`,
    });
  });
}

export type InvitationStatus = 'PENDING' | 'EXPIRED' | 'REVOKED' | 'USED';

export interface InvitationView {
  readonly status: InvitationStatus;
  readonly treeName: string;
  readonly treeSlug: string;
  readonly role: TreeRole;
  readonly email: string;
  readonly invitedBy: string;
  readonly expiresAt: Date;
}

/** What the link leads to. Null when it leads nowhere. */
export async function findInvitation(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<InvitationView | null> {
  const invitation = await db.treeInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: {
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      invitedBy: { select: { name: true } },
      tree: { select: { name: true, slug: true, deletedAt: true } },
    },
  });
  if (!invitation || invitation.tree.deletedAt) return null;
  return {
    status: statusOf(invitation, now),
    treeName: invitation.tree.name,
    treeSlug: invitation.tree.slug,
    role: invitation.role,
    email: invitation.email,
    invitedBy: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt,
  };
}

function statusOf(
  invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): InvitationStatus {
  if (invitation.revokedAt) return 'REVOKED';
  if (invitation.acceptedAt) return 'USED';
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'PENDING';
}

/**
 * Join a tree through an invitation.
 *
 * The account must be the one invited: a link forwarded to someone else, or
 * opened while signed in to another account, does not let that account in.
 * The link works once — claimed by a conditional update, so two tabs
 * accepting at the same moment cannot both succeed.
 */
export async function acceptInvitation(
  db: Database,
  input: { readonly token: string; readonly userId: string },
  now: Date = new Date(),
): Promise<{ readonly treeSlug: string; readonly role: TreeRole }> {
  return db.$transaction(async (tx) => {
    const invitation = await tx.treeInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(input.token) },
      select: {
        id: true,
        treeId: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        tree: { select: { slug: true, deletedAt: true } },
      },
    });
    if (!invitation || invitation.tree.deletedAt) throw new MembershipRefused('NOT_FOUND');
    const status = statusOf(invitation, now);
    if (status !== 'PENDING') throw new MembershipRefused(status);

    const user = await tx.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { email: true },
    });
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new MembershipRefused('WRONG_ACCOUNT');
    }

    const existing = await tx.treeMember.findUnique({
      where: { treeId_userId: { treeId: invitation.treeId, userId: input.userId } },
      select: { id: true },
    });
    if (existing) throw new MembershipRefused('ALREADY_MEMBER');

    const claimed = await tx.treeInvitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) throw new MembershipRefused('USED');

    const member = await tx.treeMember.create({
      data: { treeId: invitation.treeId, userId: input.userId, role: invitation.role },
      select: { id: true },
    });
    await recordRevision(tx, {
      treeId: invitation.treeId,
      entityType: 'TreeMember',
      entityId: member.id,
      action: 'CREATE',
      actorId: input.userId,
      after: { role: invitation.role, userId: input.userId },
      summary: `A rejoint l’arbre (${ROLE_LABELS[invitation.role]})`,
    });

    return { treeSlug: invitation.tree.slug, role: invitation.role };
  });
}
