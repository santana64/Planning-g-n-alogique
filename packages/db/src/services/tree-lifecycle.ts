import { can, type TreeRole } from '@chronolignee/domain';
import { sql } from '../../generated/client/internal/prismaNamespace';
import type { Database } from '../client';
import { diffFields, recordRevision } from './audit';

/**
 * A tree's settings, and its end.
 *
 * Deleting a tree is final and happens in two steps. The first, here, is
 * immediate: the tree disappears from every page and every invitation link in
 * the same transaction. The second — its rows and its stored files — follows
 * at once in the request that asked, and if that is interrupted a sweeper
 * finishes it: a half-erased family archive is still somebody's family
 * archive, and it must not linger because a network call failed.
 *
 * Who may do what is the permission table's; the role is read inside the
 * transaction, never taken from the caller.
 */

export type TreeVisibility = 'PRIVATE' | 'LINK' | 'PUBLIC';

export type TreeChangeRefusal =
  'NOT_ALLOWED' | 'NOT_FOUND' | 'INVALID_NAME' | 'CONFIRMATION_MISMATCH';

export class TreeChangeRefused extends Error {
  constructor(readonly code: TreeChangeRefusal) {
    super(code);
    this.name = 'TreeChangeRefused';
  }
}

type Tx = Parameters<Parameters<Database['$transaction']>[0]>[0];

async function roleIn(tx: Tx, treeId: string, userId: string): Promise<TreeRole | null> {
  const member = await tx.treeMember.findUnique({
    where: { treeId_userId: { treeId, userId } },
    select: { role: true },
  });
  return member?.role ?? null;
}

export interface TreeSettingsInput {
  readonly treeId: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: TreeVisibility;
  readonly redactLivingPeople: boolean;
}

export async function updateTreeSettings(
  db: Database,
  input: TreeSettingsInput,
  actor: { readonly userId: string },
): Promise<void> {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new TreeChangeRefused('INVALID_NAME');
  const description = input.description.trim().slice(0, 2000) || null;

  await db.$transaction(async (tx) => {
    if (!can(await roleIn(tx, input.treeId, actor.userId), 'manageTree')) {
      throw new TreeChangeRefused('NOT_ALLOWED');
    }
    const existing = await tx.tree.findFirst({
      where: { id: input.treeId, deletedAt: null },
      select: { name: true, description: true, visibility: true, redactLivingPeople: true },
    });
    if (!existing) throw new TreeChangeRefused('NOT_FOUND');

    const changes = {
      name,
      description,
      visibility: input.visibility,
      redactLivingPeople: input.redactLivingPeople,
    };
    const diff = diffFields(existing as Record<string, unknown>, changes);
    if (!diff) return;

    // The revision counter too: what a stranger may see has changed, and a
    // layout cached under the previous rule must not be served under this one.
    await tx.tree.update({
      where: { id: input.treeId },
      data: { ...changes, revision: { increment: 1 } },
    });
    await recordRevision(tx, {
      treeId: input.treeId,
      entityType: 'Tree',
      entityId: input.treeId,
      action: 'UPDATE',
      actorId: actor.userId,
      before: diff.before,
      after: diff.after,
      summary: 'Réglages de l’arbre modifiés',
    });
  });
}

/**
 * Take a tree out of use, at once.
 *
 * The owner types the tree's name: a button alone is one click from the loss
 * of decades of research, and a name typed on purpose is not.
 */
export async function markTreeDeleted(
  db: Database,
  input: { readonly treeId: string; readonly confirmation: string },
  actor: { readonly userId: string },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw(sql`SELECT 1 FROM "trees" WHERE "id" = ${input.treeId}::uuid FOR UPDATE`);
    if (!can(await roleIn(tx, input.treeId, actor.userId), 'deleteTree')) {
      throw new TreeChangeRefused('NOT_ALLOWED');
    }
    const tree = await tx.tree.findFirst({
      where: { id: input.treeId, deletedAt: null },
      select: { name: true },
    });
    if (!tree) throw new TreeChangeRefused('NOT_FOUND');
    if (input.confirmation.trim() !== tree.name.trim()) {
      throw new TreeChangeRefused('CONFIRMATION_MISMATCH');
    }
    await tx.tree.update({ where: { id: input.treeId }, data: { deletedAt: new Date() } });
  });
}

/**
 * Remove a deleted tree's rows: people, events, sources, documents' records,
 * members, invitations, history — everything cascades from the tree.
 *
 * Only ever a tree already marked deleted, so no path can erase a live one by
 * mistake. The caller removes the stored files first; this is the last step.
 */
export async function purgeDeletedTree(db: Database, treeId: string): Promise<boolean> {
  const { count } = await db.tree.deleteMany({
    where: { id: treeId, deletedAt: { not: null } },
  });
  return count === 1;
}

/** Trees marked deleted whose purge has not finished, oldest first. */
export async function treesAwaitingPurge(db: Database, limit = 50): Promise<string[]> {
  const trees = await db.tree.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true },
    orderBy: { deletedAt: 'asc' },
    take: limit,
  });
  return trees.map((tree) => tree.id);
}
