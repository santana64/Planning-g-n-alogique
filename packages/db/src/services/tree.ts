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

/** PostgreSQL unique-violation, as Prisma reports it. */
function isSlugCollision(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export async function createTree(
  db: Database,
  input: CreateTreeInput,
  ownerId: string,
): Promise<TreeWriteResult> {
  const name = input.name.trim();
  if (!name) throw new Error("L'arbre doit avoir un nom.");

  const base = slugify(name);

  /**
   * Insert, and let the database settle collisions.
   *
   * The obvious version asks whether the slug is free and then inserts it —
   * and two people creating "Famille Martin" in the same second both find it
   * free, both insert, and one gets a unique-constraint error reported to
   * them as "the tree could not be created". Two families called Martin is
   * the normal case, not an edge case.
   *
   * The only check that holds under concurrency is the unique index itself,
   * so the attempt is the check: collide, suffix, try again.
   */
  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      return await insertTree(db, { name, slug, input, ownerId });
    } catch (error) {
      if (!isSlugCollision(error)) throw error;
    }
  }

  // Exhausted the readable suffixes. A random tail is uglier than "-7" and
  // still better than refusing to create the tree.
  const slug = `${base}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return insertTree(db, { name, slug, input, ownerId });
}

async function insertTree(
  db: Database,
  args: { name: string; slug: string; input: CreateTreeInput; ownerId: string },
): Promise<TreeWriteResult> {
  const { name, slug, input, ownerId } = args;

  return db.$transaction(async (tx) => {
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

    // In the same transaction as the tree. A tree that exists for a moment
    // with no member is a tree nobody can open, and recovering one means
    // touching the database by hand.
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
