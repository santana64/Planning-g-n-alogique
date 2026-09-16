import { foldName } from '../normalise';
import type { Database } from '../client';
import { recordRevision } from './audit';

/**
 * Creating a tree.
 *
 * The first thing an account does and, until it exists, the only thing it can
 * do — every other write needs a tree to belong to.
 *
 * The creator becomes OWNER in the same transaction. A tree that exists for a
 * moment with no member is a tree nobody can open, and recovering one means
 * touching the database by hand.
 */

export interface CreateTreeInput {
  readonly name: string;
  readonly description?: string | undefined;
  readonly visibility?: 'PRIVATE' | 'LINK' | 'PUBLIC';
}

export interface TreeWriteResult {
  readonly treeId: string;
  readonly slug: string;
}

/**
 * A URL-safe slug from a family name.
 *
 * Accents are folded rather than stripped, so "Lefèvre" becomes "lefevre" and
 * not "lefvre". The result is only a convenience: the id is what everything
 * else refers to, so a collision can be resolved by appending rather than by
 * refusing the user's chosen name.
 */
export function slugify(name: string): string {
  const base = foldName(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'arbre';
}

export async function createTree(
  db: Database,
  input: CreateTreeInput,
  ownerId: string,
): Promise<TreeWriteResult> {
  const name = input.name.trim();
  if (!name) throw new Error("L'arbre doit avoir un nom.");

  return db.$transaction(async (tx) => {
    const base = slugify(name);

    // Slugs are unique, and two families called Martin is the normal case
    // rather than the exception. Suffixing is tried a bounded number of times
    // and then falls back to something certainly free, so this cannot spin.
    let slug = base;
    for (let attempt = 2; attempt <= 40; attempt += 1) {
      const taken = await tx.tree.findUnique({ where: { slug }, select: { id: true } });
      if (!taken) break;
      slug = `${base}-${attempt}`;
    }
    const stillTaken = await tx.tree.findUnique({ where: { slug }, select: { id: true } });
    if (stillTaken) slug = `${base}-${Date.now().toString(36)}`;

    const tree = await tx.tree.create({
      data: {
        name,
        slug,
        ...(input.description ? { description: input.description } : {}),
        // Private until its owner decides otherwise. A genealogy holds the
        // birth dates and addresses of living relatives who never agreed to
        // be published, so the safe posture is the default one.
        visibility: input.visibility ?? 'PRIVATE',
      },
    });

    await tx.treeMember.create({
      data: { treeId: tree.id, userId: ownerId, role: 'OWNER' },
    });

    await recordRevision(tx, {
      treeId: tree.id,
      entityType: 'Tree',
      entityId: tree.id,
      action: 'CREATE',
      actorId: ownerId,
      after: { name, slug },
      summary: `Arbre « ${name} » créé`,
    });

    return { treeId: tree.id, slug };
  });
}

export interface TreeSummary {
  readonly treeId: string;
  readonly name: string;
  readonly slug: string;
  readonly role: string;
  readonly peopleCount: number;
}

/** The trees an account can open, most recently touched first. */
export async function listTreesForUser(db: Database, userId: string): Promise<TreeSummary[]> {
  const memberships = await db.treeMember.findMany({
    where: { userId, tree: { deletedAt: null } },
    select: {
      role: true,
      tree: {
        select: {
          id: true,
          name: true,
          slug: true,
          updatedAt: true,
          _count: { select: { people: { where: { deletedAt: null } } } },
        },
      },
    },
    orderBy: { tree: { updatedAt: 'desc' } },
  });

  return memberships.map((membership) => ({
    treeId: membership.tree.id,
    name: membership.tree.name,
    slug: membership.tree.slug,
    role: membership.role,
    peopleCount: membership.tree._count.people,
  }));
}
