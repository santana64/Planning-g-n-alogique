import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createTree, listTreesForUser, slugify, type Database } from '../src/index';

/**
 * Creating a tree.
 *
 * The first thing an account does, and until it exists the only thing it can
 * do. The interesting case is concurrency: two families called Martin is the
 * normal case, and the obvious check-then-insert hands one of them an
 * unexplained failure.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let userId: string;
const created: string[] = [];

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const user = await db.user.create({
    data: {
      email: `tree-test-${Date.now()}-${Math.random().toString(36).slice(2)}@chronolignee.invalid`,
      name: 'Test arbres',
      emailVerified: false,
    },
  });
  userId = user.id;
}, 60_000);

afterAll(async () => {
  for (const id of created) await db.tree.delete({ where: { id } }).catch(() => undefined);
  if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
  await db.$disconnect();
});

async function make(name: string) {
  const result = await createTree(db, { name }, userId);
  created.push(result.treeId);
  return result;
}

describe('slugs', () => {
  it('folds accents rather than dropping them', () => {
    // "lefvre" would be the result of stripping instead of folding, and it
    // matches nothing anyone would type.
    expect(slugify('Famille Lefèvre')).toBe('famille-lefevre');
  });

  it('falls back rather than producing an empty slug', () => {
    expect(slugify('!!!')).toBe('arbre');
  });
});

describe('creating a tree', () => {
  it('makes the creator its owner in the same write', async () => {
    const tree = await make(`Famille Owner ${Date.now()}`);
    const membership = await db.treeMember.findFirstOrThrow({
      where: { treeId: tree.treeId, userId },
      select: { role: true },
    });
    // A tree that exists for a moment with no member is a tree nobody can
    // open, and recovering one means touching the database by hand.
    expect(membership.role).toBe('OWNER');
  });

  it('is private until its owner says otherwise', async () => {
    const tree = await make(`Famille Privee ${Date.now()}`);
    const row = await db.tree.findUniqueOrThrow({
      where: { id: tree.treeId },
      select: { visibility: true, redactLivingPeople: true },
    });
    expect(row.visibility).toBe('PRIVATE');
    expect(row.redactLivingPeople).toBe(true);
  });

  it('suffixes a second tree of the same name', async () => {
    const name = `Famille Martin ${Date.now()}`;
    const first = await make(name);
    const second = await make(name);
    expect(second.slug).toBe(`${first.slug}-2`);
  });

  it('survives two identical names created at the same moment', async () => {
    // The bug this guards: check-then-insert. Both callers find the slug
    // free, both insert, and the loser is told "the tree could not be
    // created" — for something the system can settle by itself.
    const name = `Famille Concurrente ${Date.now()}`;
    const results = await Promise.all([make(name), make(name), make(name), make(name)]);

    const slugs = results.map((result) => result.slug);
    expect(new Set(slugs).size).toBe(4);
    for (const slug of slugs) expect(slug.startsWith(slugify(name))).toBe(true);
  });

  it('refuses a tree with no name', async () => {
    await expect(createTree(db, { name: '   ' }, userId)).rejects.toThrow();
  });

  it('records its own creation', async () => {
    const tree = await make(`Famille Revision ${Date.now()}`);
    const revision = await db.revision.findFirstOrThrow({
      where: { treeId: tree.treeId, entityType: 'Tree', action: 'CREATE' },
      select: { summary: true },
    });
    expect(revision.summary).toContain('Famille Revision');
  });
});

describe('listing the trees an account can open', () => {
  it('returns only trees the account belongs to', async () => {
    const mine = await make(`Famille Mienne ${Date.now()}`);

    const stranger = await db.user.create({
      data: {
        email: `stranger-${Date.now()}-${Math.random().toString(36).slice(2)}@chronolignee.invalid`,
        name: 'Étranger',
        emailVerified: false,
      },
    });
    const theirs = await createTree(db, { name: `Famille Autre ${Date.now()}` }, stranger.id);
    created.push(theirs.treeId);

    const listed = await listTreesForUser(db, userId);
    expect(listed.map((tree) => tree.treeId)).toContain(mine.treeId);
    expect(listed.map((tree) => tree.treeId)).not.toContain(theirs.treeId);

    await db.user.delete({ where: { id: stranger.id } }).catch(() => undefined);
  });
});
