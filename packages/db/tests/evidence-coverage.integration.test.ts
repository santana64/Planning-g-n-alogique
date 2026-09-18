import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCitation,
  createDatabase,
  createEvent,
  createPerson,
  createSource,
  deleteEvent,
  loadEvidenceCoverage,
  updatePerson,
  type Database,
} from '../src/index';

/**
 * Evidence coverage, person by person.
 *
 * The constellation draws it as brightness, so each rule here is something a
 * reader will see: a star that shines for a witness's citation, or for an
 * archived event, would be claiming a documentation that does not exist.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let treeId: string;
let ctx: { treeId: string; actorId: string | null };
let sourceId = '';

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const tree = await db.tree.create({
    data: { name: 'Coverage', slug: `cov-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  treeId = tree.id;
  ctx = { treeId, actorId: null };

  const source = await createSource(
    db,
    { title: 'Registre de Tours', type: 'PARISH_REGISTER' },
    ctx,
  );
  sourceId = source.sourceId;
}, 90_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

async function person(given: string, birth?: string) {
  const created = await createPerson(
    db,
    {
      recordedSex: 'UNKNOWN',
      livingStatus: 'DECEASED',
      names: [
        { type: 'BIRTH', given, surname: 'Couverture', isPreferred: true, confidence: 'MEDIUM' },
      ],
      ...(birth ? { birthDate: birth } : {}),
    },
    ctx,
  );
  return created.personId;
}

async function birthEventOf(personId: string): Promise<string> {
  const event = await db.event.findFirstOrThrow({
    where: { treeId, type: 'BIRTH', deletedAt: null, participants: { some: { personId } } },
    select: { id: true },
  });
  return event.id;
}

async function cite(eventId: string) {
  await createCitation(db, { sourceId, locator: 'vue 12', eventId }, ctx);
}

describe('evidence coverage', () => {
  it('counts a person’s own events, and the ones a citation points at', async () => {
    const id = await person('Jean', '12 JUN 1822');
    const census = await createEvent(
      db,
      { type: 'CENSUS', date: '1866', participants: [{ personId: id, role: 'PRINCIPAL' }] },
      ctx,
    );
    await cite(census.eventId);

    const coverage = await loadEvidenceCoverage(db, treeId);
    expect(coverage.get(id)).toEqual({ events: 2, cited: 1 });
  });

  it('counts a marriage for both spouses', async () => {
    const a = await person('Paul');
    const b = await person('Adèle');
    const marriage = await createEvent(
      db,
      {
        type: 'MARRIAGE',
        date: '1878',
        participants: [
          { personId: a, role: 'SPOUSE' },
          { personId: b, role: 'SPOUSE' },
        ],
      },
      ctx,
    );
    await cite(marriage.eventId);

    const coverage = await loadEvidenceCoverage(db, treeId);
    expect(coverage.get(a)).toEqual({ events: 1, cited: 1 });
    expect(coverage.get(b)).toEqual({ events: 1, cited: 1 });
  });

  it('gives a witness no credit for someone else’s documented event', async () => {
    const subject = await person('Céline', '1825');
    const witness = await person('Témoin');
    const baptism = await createEvent(
      db,
      {
        type: 'BAPTISM',
        date: '1825',
        participants: [
          { personId: subject, role: 'PRINCIPAL' },
          { personId: witness, role: 'WITNESS' },
        ],
      },
      ctx,
    );
    await cite(baptism.eventId);

    const coverage = await loadEvidenceCoverage(db, treeId);
    expect(coverage.get(subject)?.cited).toBe(1);
    // Absent, not zero: the witness has no events of their own at all.
    expect(coverage.has(witness)).toBe(false);
  });

  it('forgets an archived event, sourced or not', async () => {
    const id = await person('Rosalie', '1827');
    await cite(await birthEventOf(id));
    // Correcting the date archives the cited event and writes a new one,
    // which nobody has sourced yet.
    await updatePerson(db, { personId: id, birthDate: '2 MAR 1827' }, ctx);

    const coverage = await loadEvidenceCoverage(db, treeId);
    expect(coverage.get(id)).toEqual({ events: 1, cited: 0 });
  });

  it('forgets a deleted event', async () => {
    const id = await person('Henri', '1820');
    const census = await createEvent(
      db,
      { type: 'CENSUS', date: '1851', participants: [{ personId: id, role: 'PRINCIPAL' }] },
      ctx,
    );
    await cite(census.eventId);
    await deleteEvent(db, census.eventId, ctx);

    const coverage = await loadEvidenceCoverage(db, treeId);
    expect(coverage.get(id)).toEqual({ events: 1, cited: 0 });
  });

  it('counts an event with several citations once', async () => {
    const id = await person('Mathurin', '1702');
    const birth = await birthEventOf(id);
    await cite(birth);
    await cite(birth);

    const coverage = await loadEvidenceCoverage(db, treeId);
    expect(coverage.get(id)).toEqual({ events: 1, cited: 1 });
  });
});
