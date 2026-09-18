import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/index';

/**
 * The indexes Prisma cannot be trusted with.
 *
 * Some indexes are written by hand in migration SQL because Prisma cannot
 * express them: an expression index on an unaccent function, a GiST index on
 * an Unsupported(geography) column. Prisma sees each one as drift, and every
 * `migrate dev` generates a DROP INDEX for it. The first time that happened
 * here it would have removed fuzzy name search's trigram indexes and the
 * spatial index in one migration, and nothing would have failed — queries stay
 * correct, they just become table scans.
 *
 * So the check is on the live database, after migrations, whatever produced
 * them. A missing index is a red test rather than a slow production.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const REQUIRED_INDEXES: readonly { name: string; table: string; method: string }[] = [
  { name: 'people_search_name_trgm', table: 'people', method: 'gin' },
  { name: 'person_names_surname_trgm', table: 'person_names', method: 'gin' },
  { name: 'person_names_given_trgm', table: 'person_names', method: 'gin' },
  { name: 'places_name_trgm', table: 'places', method: 'gin' },
  { name: 'sources_title_trgm', table: 'sources', method: 'gin' },
  { name: 'places_geom_gist', table: 'places', method: 'gist' },
];

let db: Database;

beforeAll(() => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });
});

afterAll(async () => {
  await db.$disconnect();
});

describe('hand-maintained indexes', () => {
  it.each(REQUIRED_INDEXES)('$name exists, on $table, as $method', async (expected) => {
    const rows = await db.$queryRawUnsafe<{ tablename: string; indexdef: string }[]>(
      `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      expected.name,
    );

    expect(rows, `${expected.name} is missing — a migration probably dropped it`).toHaveLength(1);
    expect(rows[0]?.tablename).toBe(expected.table);
    expect(rows[0]?.indexdef.toLowerCase()).toContain(`using ${expected.method}`);
  });

  it('keeps the trigram operator class on the search indexes', async () => {
    // A plain btree with the same name would pass a presence check and still
    // make every `LIKE '%x%'` a scan. The operator class is the point.
    const rows = await db.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND indexname LIKE '%\\_trgm' ESCAPE '\\'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      expect(row.indexdef, row.indexname).toContain('gin_trgm_ops');
    }
  });
});
