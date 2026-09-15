import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseGenealogicalDate } from '@chronolignee/domain';
import { createDatabase, encodeDate, decodeDate, type Database } from '../src/index';

/**
 * Schema integration tests.
 *
 * These run against the real PostgreSQL from docker-compose, because the
 * things being verified — CHECK constraints, uniqueness, cascade behaviour,
 * PostGIS — exist only in the database. A mock would assert that our
 * assumptions are self-consistent, which is not the question.
 *
 * Every test works inside its own tree and deletes it afterwards, so the suite
 * is safe to run against a development database with real work in it.
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
  if (!url) throw new Error('DATABASE_URL is required for integration tests');
  db = createDatabase({ url });

  const tree = await db.tree.create({
    data: { name: 'Test tree', slug: `test-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  treeId = tree.id;
});

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

async function makePerson(displayName: string) {
  return db.person.create({ data: { treeId, displayName, searchName: displayName.toLowerCase() } });
}

describe('identifiers', () => {
  it('generates UUIDv7 ids that sort by creation order', async () => {
    const a = await makePerson('A');
    const b = await makePerson('B');
    const c = await makePerson('C');
    // UUIDv7 embeds a timestamp prefix, so lexical order is creation order.
    // This is what makes keyset pagination over people cheap.
    expect([a.id, b.id, c.id].every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    expect([a.id, b.id, c.id]).toEqual([a.id, b.id, c.id].slice().sort());
  });
});

describe('date round-trip through the database', () => {
  it.each([
    '12 JUN 1877',
    'ABT 1877',
    'BEF 1877',
    'BET 1877 AND 1880',
    'FROM 1877 TO 1880',
    '18 brumaire an VIII',
  ])('preserves %s', async (input) => {
    const original = parseGenealogicalDate(input);
    const event = await db.event.create({
      data: { treeId, type: 'BIRTH', ...encodeDate(original) },
    });

    const stored = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    const decoded = decodeDate(stored);

    expect(decoded.qualifier).toBe(original.qualifier);
    expect(decoded.calendar).toBe(original.calendar);
    expect(decoded.interval).toEqual(original.interval);
    expect(decoded.originalText).toBe(original.originalText);
  });

  it('keeps the source wording for a date it could not parse', async () => {
    const original = parseGenealogicalDate('9br 1789');
    const event = await db.event.create({
      data: { treeId, type: 'BIRTH', ...encodeDate(original) },
    });
    const stored = await db.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.dateOriginalText).toBe('9br 1789');
    expect(stored.dateUnparsed).toBe(true);
  });
});

describe('integrity constraints are enforced by the database, not just by code', () => {
  it('rejects a claim with no subject', async () => {
    await expect(
      db.claim.create({ data: { treeId, predicate: 'BIRTH_DATE', value: {} } }),
    ).rejects.toThrow(/claims_exactly_one_subject/);
  });

  it('rejects a claim with two subjects', async () => {
    const person = await makePerson('Two subjects');
    const event = await db.event.create({ data: { treeId, type: 'BIRTH' } });
    await expect(
      db.claim.create({
        data: {
          treeId,
          personId: person.id,
          eventId: event.id,
          predicate: 'BIRTH_DATE',
          value: {},
        },
      }),
    ).rejects.toThrow(/claims_exactly_one_subject/);
  });

  it('rejects a person being their own parent', async () => {
    const person = await makePerson('Self parent');
    await expect(
      db.relationship.create({
        data: { treeId, sourceId: person.id, targetId: person.id, type: 'PARENT_BIOLOGICAL' },
      }),
    ).rejects.toThrow(/relationships_no_self_reference/);
  });

  it('rejects a lifespan whose end precedes its start', async () => {
    await expect(
      db.person.create({
        data: {
          treeId,
          displayName: 'Backwards',
          lifespanEarliestJdn: 2_400_000,
          lifespanLatestJdn: 2_300_000,
        },
      }),
    ).rejects.toThrow(/people_lifespan_window_ordered/);
  });

  it('rejects a CUSTOM event with no label', async () => {
    await expect(db.event.create({ data: { treeId, type: 'CUSTOM' } })).rejects.toThrow(
      /events_custom_type_labelled/,
    );
  });

  it('accepts a CUSTOM event that says what it is', async () => {
    const event = await db.event.create({
      data: { treeId, type: 'CUSTOM', customType: 'Remise de la Légion d honneur' },
    });
    expect(event.customType).toContain('Légion');
  });

  it('rejects impossible coordinates', async () => {
    await expect(
      db.place.create({ data: { treeId, name: 'Nowhere', latitude: 200, longitude: 0 } }),
    ).rejects.toThrow(/places_coordinates_valid/);
  });

  it('rejects a duplicate pair stored in the wrong order', async () => {
    const a = await makePerson('Dup A');
    const b = await makePerson('Dup B');
    const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await expect(
      db.duplicateCandidate.create({
        data: {
          treeId,
          leftId: high,
          rightId: low,
          score: 0.9,
          scorerVersion: 'v1',
          explanation: {},
        },
      }),
    ).rejects.toThrow(/duplicate_candidates_ordered_pair/);
  });

  it('rejects a duplicate score outside 0..1', async () => {
    const a = await makePerson('Score A');
    const b = await makePerson('Score B');
    const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await expect(
      db.duplicateCandidate.create({
        data: {
          treeId,
          leftId: low,
          rightId: high,
          score: 1.5,
          scorerVersion: 'v1',
          explanation: {},
        },
      }),
    ).rejects.toThrow(/duplicate_candidates_score_range/);
  });

  it('rejects a second identical relationship between the same pair', async () => {
    const parent = await makePerson('Parent');
    const child = await makePerson('Child');
    const data = {
      treeId,
      sourceId: parent.id,
      targetId: child.id,
      type: 'PARENT_BIOLOGICAL' as const,
    };
    await db.relationship.create({ data });
    await expect(db.relationship.create({ data })).rejects.toThrow();
  });

  it('allows a biological and an adoptive parent side by side', async () => {
    const bioParent = await makePerson('Bio parent');
    const adoptiveParent = await makePerson('Adoptive parent');
    const child = await makePerson('Adopted child');

    await db.relationship.create({
      data: { treeId, sourceId: bioParent.id, targetId: child.id, type: 'PARENT_BIOLOGICAL' },
    });
    await db.relationship.create({
      data: { treeId, sourceId: adoptiveParent.id, targetId: child.id, type: 'PARENT_ADOPTIVE' },
    });

    const parents = await db.relationship.findMany({ where: { targetId: child.id } });
    expect(parents).toHaveLength(2);
  });
});

describe('conflicting claims coexist', () => {
  it('keeps a disputed birth year alongside the accepted one', async () => {
    const person = await makePerson('Disputed');

    const accepted = await db.claim.create({
      data: {
        treeId,
        personId: person.id,
        predicate: 'BIRTH_DATE',
        value: { year: 1877 },
        valueText: '12 juin 1877',
        status: 'ACCEPTED',
        confidence: 'HIGH',
      },
    });
    const disputed = await db.claim.create({
      data: {
        treeId,
        personId: person.id,
        predicate: 'BIRTH_DATE',
        value: { year: 1878 },
        valueText: '1878',
        status: 'DISPUTED',
        confidence: 'MEDIUM',
      },
    });

    const all = await db.claim.findMany({
      where: { personId: person.id, predicate: 'BIRTH_DATE' },
    });
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.status).sort()).toEqual(['ACCEPTED', 'DISPUTED']);
    expect(accepted.id).not.toBe(disputed.id);
  });
});

describe('PostGIS', () => {
  it('stores and queries a geography point', async () => {
    const place = await db.place.create({
      data: {
        treeId,
        name: 'Tours',
        normalisedName: 'tours',
        latitude: 47.3941,
        longitude: 0.6848,
      },
    });

    await db.$executeRaw`
      UPDATE places SET geom = ST_SetSRID(ST_MakePoint(${0.6848}, ${47.3941}), 4326)::geography
      WHERE id = ${place.id}::uuid`;

    // Distance Tours -> Paris is roughly 205 km. The assertion is loose on
    // purpose: the point is that PostGIS is doing real geodesic maths.
    const rows = await db.$queryRaw<Array<{ km: number }>>`
      SELECT ST_Distance(geom, ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326)::geography) / 1000 AS km
      FROM places WHERE id = ${place.id}::uuid`;

    expect(rows[0]?.km).toBeGreaterThan(180);
    expect(rows[0]?.km).toBeLessThan(230);
  });
});

describe('accent-insensitive search', () => {
  it('finds Lefevre when the record says Lefèvre', async () => {
    const person = await db.person.create({
      data: { treeId, displayName: 'Marie LEFÈVRE', searchName: 'marie lefevre' },
    });

    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM people
      WHERE "treeId" = ${treeId}::uuid
        AND "searchName" % chronolignee_unaccent(lower(${'Lefevre'}))`;

    expect(rows.map((r) => r.id)).toContain(person.id);
  });
});

describe('cascade behaviour', () => {
  it('deleting a tree removes its people', async () => {
    const scratch = await db.tree.create({
      data: {
        name: 'Scratch',
        slug: `scratch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const person = await db.person.create({
      data: { treeId: scratch.id, displayName: 'Ephemeral' },
    });

    await db.tree.delete({ where: { id: scratch.id } });

    expect(await db.person.findUnique({ where: { id: person.id } })).toBeNull();
  });
});
