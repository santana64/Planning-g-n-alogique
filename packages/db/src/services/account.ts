import type { TreeRole } from '@chronolignee/domain';
import { sql } from '../../generated/client/internal/prismaNamespace';
import type { Database } from '../client';
import { recordRevision } from './audit';

/**
 * Erasing an account.
 *
 * What goes: the account, its sessions and credentials, its memberships, the
 * invitations it sent and those addressed to it, and every tree it was the
 * only member of. What stays: the research in trees other people share. Those
 * records belong to the family's work, not to the account that typed them;
 * the history keeps each change but no longer says who made it — revisions
 * point at an account, and the account is gone.
 *
 * What blocks: a tree this account alone owns while others still work in it.
 * Erasing it would take their research with it, and leaving it ownerless
 * would lock them out of their own tree; someone must be named owner first.
 */

export interface TreeRef {
  readonly treeId: string;
  readonly name: string;
  readonly slug: string;
}

export interface AccountErasurePlan {
  /** Owned alone while others still belong: an owner must be named first. */
  readonly blocking: readonly TreeRef[];
  /** Nobody else belongs: these go with the account. */
  readonly erasedWithAccount: readonly TreeRef[];
  /** Shared trees the account simply leaves. */
  readonly left: readonly TreeRef[];
}

export class AccountErasureBlocked extends Error {
  constructor(readonly trees: readonly TreeRef[]) {
    super('ACCOUNT_ERASURE_BLOCKED');
    this.name = 'AccountErasureBlocked';
  }
}

type Client = Pick<Database, 'treeMember'>;

interface Membership extends TreeRef {
  readonly memberId: string;
  readonly role: TreeRole;
}

async function memberships(
  db: Client,
  userId: string,
): Promise<{ plan: AccountErasurePlan; left: Membership[] }> {
  const rows = await db.treeMember.findMany({
    where: { userId, tree: { deletedAt: null } },
    select: {
      id: true,
      role: true,
      tree: {
        select: {
          id: true,
          name: true,
          slug: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const blocking: TreeRef[] = [];
  const erasedWithAccount: TreeRef[] = [];
  const left: Membership[] = [];
  for (const row of rows) {
    const ref = { treeId: row.tree.id, name: row.tree.name, slug: row.tree.slug };
    const others = row.tree.members.filter((member) => member.userId !== userId);
    if (row.role === 'OWNER' && !others.some((member) => member.role === 'OWNER')) {
      (others.length > 0 ? blocking : erasedWithAccount).push(ref);
    } else {
      left.push({ ...ref, memberId: row.id, role: row.role });
    }
  }
  return { plan: { blocking, erasedWithAccount, left }, left };
}

/** What erasing this account would do, for the page that asks to confirm it. */
export async function planAccountErasure(
  db: Database,
  userId: string,
): Promise<AccountErasurePlan> {
  return (await memberships(db, userId)).plan;
}

export async function eraseAccount(
  db: Database,
  userId: string,
): Promise<{ readonly treesToPurge: readonly string[] }> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return { treesToPurge: [] };

    // Lock the trees this account owns, so someone joining one at this very
    // instant is counted: a tree erased with its "only" member must really
    // have had no other.
    const owned = await tx.treeMember.findMany({
      where: { userId, role: 'OWNER' },
      select: { treeId: true },
      orderBy: { treeId: 'asc' },
    });
    for (const { treeId } of owned) {
      await tx.$queryRaw(sql`SELECT 1 FROM "trees" WHERE "id" = ${treeId}::uuid FOR UPDATE`);
    }

    const { plan, left } = await memberships(tx, userId);
    if (plan.blocking.length > 0) throw new AccountErasureBlocked(plan.blocking);

    const now = new Date();
    if (plan.erasedWithAccount.length > 0) {
      await tx.tree.updateMany({
        where: { id: { in: plan.erasedWithAccount.map((tree) => tree.treeId) } },
        data: { deletedAt: now },
      });
    }

    // The shared trees say that someone left — by account, as every
    // membership revision does, so nothing here names them.
    for (const membership of left) {
      await recordRevision(tx, {
        treeId: membership.treeId,
        entityType: 'TreeMember',
        entityId: membership.memberId,
        action: 'DELETE',
        actorId: null,
        before: { role: membership.role, userId },
        summary: 'Compte supprimé',
      });
    }

    // Invitations addressed to this account carry its address; those it sent
    // go with it by cascade. Pending password resets and the like too.
    await tx.treeInvitation.deleteMany({ where: { email: user.email } });
    await tx.verification.deleteMany({
      where: { OR: [{ identifier: user.email }, { value: userId }] },
    });

    // Sessions, credentials, memberships and sent invitations cascade;
    // authorship of revisions, claims and reviews is detached (SET NULL).
    await tx.user.delete({ where: { id: userId } });

    return { treesToPurge: plan.erasedWithAccount.map((tree) => tree.treeId) };
  });
}
