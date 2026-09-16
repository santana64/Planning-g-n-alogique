import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createPerson,
  searchPeople,
  searchPlaces,
  type Database,
} from '../src/index';

/**
 * Search.
 *
 * Raw SQL, so a typecheck proves nothing: the query either runs against a real
 * PostgreSQL with pg_trgm or it does not. And the behaviour worth protecting
 * is not "finds the name you typed" — it is "finds the name the other clerk
 * wrote", which is the whole reason a genealogist searches at all.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let treeId: string;

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const tree = await db.tree.create({
    data: { name: 'Search', slug: `search-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  treeId = tree.id;
  const ctx = { treeId, actorId: null };

  const add = (given: string, surname: string, birth?: string) =>
    createPerson(
      db,
      {
        recordedSex: 'UNKNOWN',
        livingStatus: 'UNKNOWN',
        names: [{ type: 'BIRTH', given, surname, isPreferred: true, confidence: 'MEDIUM' }],
        ...(birth ? { birthDate: birth } : {}),
        ...(birth ? { birthPlace: 'Tours, Indre-et-Loire, France' } : {}),
      },
      ctx,
    );

  await add('Jean-Baptiste', 'Chassagne', '1822');
  await add('Augustin', 'Chassaigne', '1823');
  await add('Marie', 'Lefèvre', '1850');
  await add('Anne', 'Chassagne', '1901');
  await add('Hippolyte', 'Moreau', '1857');
}, 60_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('finding a person', () => {
  it('finds the exact spelling first', async () => {
    const hits = await searchPeople(db, { treeId, query: 'Jean-Baptiste Chassagne' });
    expect(hits[0]?.displayName).toBe('Jean-Baptiste CHASSAGNE');
  });

  it('finds the other clerk’s spelling too', async () => {
    // The whole point. Searching CHASSAIGNE must surface the CHASSAGNE
    // family, because that pair is the duplicate the researcher is hunting.
    const hits = await searchPeople(db, { treeId, query: 'chassaigne' });
    const names = hits.map((hit) => hit.displayName);
    expect(names).toContain('Augustin CHASSAIGNE');
    expect(names.some((name) => name.includes('CHASSAGNE'))).toBe(true);
  });

  it('marks a match the researcher did not literally type', async () => {
    const hits = await searchPeople(db, { treeId, query: 'chassaigne' });
    const fuzzy = hits.find((hit) => hit.displayName.includes('CHASSAGNE'));
    // Presenting a near-miss as though the spelling matched would be a small
    // lie about what the archive holds.
    expect(fuzzy?.approximate).toBe(true);
    expect(hits.find((hit) => hit.displayName === 'Augustin CHASSAIGNE')?.approximate).toBe(false);
  });

  it('ignores accents in both directions', async () => {
    const withAccent = await searchPeople(db, { treeId, query: 'Lefèvre' });
    const without = await searchPeople(db, { treeId, query: 'lefevre' });
    expect(withAccent[0]?.displayName).toBe('Marie LEFÈVRE');
    expect(without[0]?.displayName).toBe('Marie LEFÈVRE');
  });

  it('reads a year in the query and ranks by it', async () => {
    // Two people share a surname; the year says which one is meant.
    const hits = await searchPeople(db, { treeId, query: 'chassagne 1901' });
    expect(hits[0]?.displayName).toBe('Anne CHASSAGNE');

    const other = await searchPeople(db, { treeId, query: 'chassagne 1822' });
    expect(other[0]?.displayName).toBe('Jean-Baptiste CHASSAGNE');
  });

  it('ranks a year down rather than filtering it out', async () => {
    // A birth recorded as 1823 when the researcher typed 1822 is exactly the
    // record they are trying to reconcile. Removing it would hide the answer.
    const hits = await searchPeople(db, { treeId, query: 'chassaigne 1899' });
    expect(hits.map((hit) => hit.displayName)).toContain('Augustin CHASSAIGNE');
  });

  it('returns nothing for an empty query rather than everyone', async () => {
    expect(await searchPeople(db, { treeId, query: '   ' })).toEqual([]);
  });

  it('never reaches into another tree', async () => {
    const other = await db.tree.create({
      data: { name: 'Autre', slug: `other-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    });
    await createPerson(
      db,
      {
        recordedSex: 'UNKNOWN',
        livingStatus: 'UNKNOWN',
        names: [
          {
            type: 'BIRTH',
            given: 'Jean-Baptiste',
            surname: 'Chassagne',
            isPreferred: true,
            confidence: 'LOW',
          },
        ],
      },
      { treeId: other.id, actorId: null },
    );

    const hits = await searchPeople(db, { treeId, query: 'chassagne' });
    expect(hits.filter((hit) => hit.displayName === 'Jean-Baptiste CHASSAGNE')).toHaveLength(1);

    await db.tree.delete({ where: { id: other.id } });
  });

  it('respects the limit', async () => {
    const hits = await searchPeople(db, { treeId, query: 'chassagne', limit: 1 });
    expect(hits).toHaveLength(1);
  });
});

describe('finding a place', () => {
  it('finds a town and says how many people are tied to it', async () => {
    const hits = await searchPlaces(db, { treeId, query: 'tours' });
    expect(hits[0]?.name).toContain('Tours');
    // A number, not a bigint: "5n" on screen is how this leaks.
    expect(typeof hits[0]?.personCount).toBe('number');
    expect(hits[0]?.personCount).toBeGreaterThan(0);
  });

  it('folds accents for places as well', async () => {
    const hits = await searchPlaces(db, { treeId, query: 'indre-et-loire' });
    expect(hits.length).toBeGreaterThan(0);
  });
});
