import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createEvent, createPerson, loadAtlas, type Database } from '../src/index';

/**
 * The map's data.
 *
 * Raw SQL again, so it either runs against a real PostgreSQL or it does not.
 * The behaviour worth protecting is the pairing: sixty parish records in one
 * commune are a life, not sixty migrations.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let treeId: string;
let ctx: { treeId: string; actorId: string | null };
let traveller = '';
let livingTraveller = '';

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const tree = await db.tree.create({
    data: { name: 'Atlas', slug: `atlas-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  treeId = tree.id;
  ctx = { treeId, actorId: null };

  const person = async (given: string, living: boolean, birth: string, place: string) =>
    createPerson(
      db,
      {
        recordedSex: 'UNKNOWN',
        livingStatus: living ? 'LIVING' : 'DECEASED',
        names: [
          { type: 'BIRTH', given, surname: 'Voyageur', isPreferred: true, confidence: 'HIGH' },
        ],
        birthDate: birth,
        birthPlace: place,
      },
      ctx,
    );

  const emigrant = await person('Emigrant', false, '1 JAN 1850', 'Tours');
  traveller = emigrant.personId;
  const living = await person('Vivant', true, '1 JAN 1980', 'Tours');
  livingTraveller = living.personId;

  // Coordinates: the map cannot draw a place without them, and the writer
  // does not geocode.
  await db.place.updateMany({
    where: { treeId, name: 'Tours' },
    data: { latitude: 47.3941, longitude: 0.6848 },
  });

  // Two more records at Tours, then a move. The stay must not become moves.
  for (const date of ['1 JAN 1866', '1 JAN 1868']) {
    await createEvent(
      db,
      {
        type: 'CENSUS',
        date,
        placeName: 'Tours',
        participants: [{ personId: traveller, role: 'PRINCIPAL' }],
      },
      ctx,
    );
  }
  await createEvent(
    db,
    {
      type: 'MIGRATION',
      date: '1 JAN 1870',
      placeName: 'Buenos Aires',
      participants: [{ personId: traveller, role: 'PRINCIPAL' }],
    },
    ctx,
  );
  await createEvent(
    db,
    {
      type: 'MIGRATION',
      date: '1 JAN 2010',
      placeName: 'Buenos Aires',
      participants: [{ personId: livingTraveller, role: 'PRINCIPAL' }],
    },
    ctx,
  );
  await db.place.updateMany({
    where: { treeId, name: 'Buenos Aires' },
    data: { latitude: -34.6037, longitude: -58.3816 },
  });
}, 90_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('places', () => {
  it('leaves out a place with no coordinates', async () => {
    await db.place.create({
      data: { treeId, name: 'Lieu-dit sans carte', normalisedName: 'lieu-dit sans carte' },
    });
    const atlas = await loadAtlas(db, { treeId, redactLiving: false });
    expect(atlas.places.map((place) => place.name)).not.toContain('Lieu-dit sans carte');
  });

  it('carries the span of what was recorded there', async () => {
    const atlas = await loadAtlas(db, { treeId, redactLiving: false });
    const tours = atlas.places.find((place) => place.name === 'Tours');
    expect(tours?.eventCount).toBeGreaterThanOrEqual(3);
    // Numbers, not bigints: "59n" on screen is how this leaks.
    expect(typeof tours?.eventCount).toBe('number');
    expect(tours?.earliestJdn).not.toBeNull();
    expect(tours?.latestJdn).toBeGreaterThan(tours?.earliestJdn ?? 0);
  });
});

describe('journeys', () => {
  it('pairs consecutive places into a move', async () => {
    const atlas = await loadAtlas(db, { treeId, redactLiving: false });
    const legs = atlas.legs.filter((leg) => leg.personId === traveller);
    expect(legs).toHaveLength(1);
    expect(legs[0]?.arrivalJdn).toBeGreaterThan(legs[0]?.departureJdn ?? 0);
  });

  it('does not turn a long stay into a string of migrations', async () => {
    // Three records at Tours before the departure. Naively pairing every
    // consecutive event would draw two arcs from Tours to itself.
    const atlas = await loadAtlas(db, { treeId, redactLiving: false });
    const selfLoops = atlas.legs.filter((leg) => leg.fromPlaceId === leg.toPlaceId);
    expect(selfLoops).toEqual([]);
  });

  it('withholds a living person’s path and says how many', async () => {
    const atlas = await loadAtlas(db, { treeId, redactLiving: true });
    expect(atlas.legs.some((leg) => leg.personId === livingTraveller)).toBe(false);
    // Reported rather than silently dropped: a map that quietly omits people
    // is a map that lies about the family's shape.
    expect(atlas.withheldPeople).toBeGreaterThanOrEqual(1);
  });

  it('shows the same path to a member of the tree', async () => {
    const atlas = await loadAtlas(db, { treeId, redactLiving: false });
    expect(atlas.legs.some((leg) => leg.personId === livingTraveller)).toBe(true);
    expect(atlas.withheldPeople).toBe(0);
  });
});
