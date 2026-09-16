import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dateToJdn, gregorianToJdn } from '@chronolignee/domain';
import {
  createDatabase,
  createEvent,
  createPerson,
  deleteEvent,
  updateEvent,
  updatePerson,
  type Database,
} from '../src/index';

/**
 * Events that are not birth or death, and the thing that makes a field
 * editable at all: being able to empty it again.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let treeId: string;
let ctx: { treeId: string; actorId: string | null };

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const tree = await db.tree.create({
    data: { name: 'Events', slug: `ev-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  treeId = tree.id;
  ctx = { treeId, actorId: null };
}, 60_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

async function person(given: string, surname: string, birth?: string) {
  return createPerson(
    db,
    {
      recordedSex: 'UNKNOWN',
      livingStatus: 'UNKNOWN',
      names: [{ type: 'BIRTH', given, surname, isPreferred: true, confidence: 'MEDIUM' }],
      ...(birth ? { birthDate: birth } : {}),
    },
    ctx,
  );
}

describe('clearing a field', () => {
  it('removes a birth date the researcher decided was wrong', async () => {
    // The bug this guards: an empty form field parsed to `undefined`, which
    // every update guard reads as "not sent". The save reported success and
    // the date stayed. Deleting a wrong date required typing a different
    // wrong date over it.
    const created = await person('Fausse', 'Date', '1834');
    await updatePerson(db, { personId: created.personId, birthDate: '' }, ctx);

    const live = await db.event.count({
      where: {
        treeId,
        type: 'BIRTH',
        deletedAt: null,
        participants: { some: { personId: created.personId } },
      },
    });
    expect(live).toBe(0);

    const row = await db.person.findUniqueOrThrow({
      where: { id: created.personId },
      select: { lifespanEarliestJdn: true },
    });
    expect(row.lifespanEarliestJdn).toBeNull();
  });

  it('keeps the archived event, so the removal is not a disappearance', async () => {
    const created = await person('Trace', 'Conservée', '1801');
    await updatePerson(db, { personId: created.personId, birthDate: '' }, ctx);

    const archived = await db.event.findFirstOrThrow({
      where: { treeId, type: 'BIRTH', participants: { some: { personId: created.personId } } },
      select: { dateOriginalText: true, deletedAt: true },
    });
    expect(archived.deletedAt).not.toBeNull();
    expect(archived.dateOriginalText).toBe('1801');
  });

  it('leaves a field alone when the caller says nothing about it', async () => {
    // The other half of the distinction: absent must still mean absent, or
    // every partial update would wipe everything it did not mention.
    const created = await person('Intacte', 'Valeur', '1755');
    await updatePerson(db, { personId: created.personId, notes: 'à vérifier' }, ctx);

    const row = await db.person.findUniqueOrThrow({
      where: { id: created.personId },
      select: { lifespanEarliestJdn: true, notes: true },
    });
    expect(row.notes).toBe('à vérifier');
    expect(row.lifespanEarliestJdn).toBe(gregorianToJdn(1755, 1, 1));
  });

  it('empties notes when they are emptied', async () => {
    const created = await person('Note', 'Effacée');
    await updatePerson(db, { personId: created.personId, notes: 'provisoire' }, ctx);
    await updatePerson(db, { personId: created.personId, notes: '' }, ctx);

    const row = await db.person.findUniqueOrThrow({
      where: { id: created.personId },
      select: { notes: true },
    });
    expect(row.notes).toBeNull();
  });
});

describe('creating an event', () => {
  it('belongs to everyone who took part, not to one of them', async () => {
    const groom = await person('Paul', 'Renard', '1845');
    const bride = await person('Adèle', 'Chassagne', '1849');

    const event = await createEvent(
      db,
      {
        type: 'MARRIAGE',
        date: '14 mai 1871',
        placeName: 'Tours',
        confidence: 'HIGH',
        participants: [
          { personId: groom.personId, role: 'SPOUSE' },
          { personId: bride.personId, role: 'SPOUSE' },
        ],
      },
      ctx,
    );

    const stored = await db.event.findUniqueOrThrow({
      where: { id: event.eventId },
      select: {
        dateEarliestJdn: true,
        participants: { select: { personId: true, role: true } },
        place: { select: { name: true } },
      },
    });

    expect(stored.dateEarliestJdn).toBe(gregorianToJdn(1871, 5, 14));
    expect(stored.participants).toHaveLength(2);
    expect(stored.place?.name).toBe('Tours');
  });

  it('refuses a participant from another tree', async () => {
    // Without the check the event would link two archives, and surface in a
    // tree whose owner never put it there.
    const other = await db.tree.create({
      data: {
        name: 'Ailleurs',
        slug: `other-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const outsider = await createPerson(
      db,
      {
        recordedSex: 'UNKNOWN',
        livingStatus: 'UNKNOWN',
        names: [{ type: 'BIRTH', given: 'Étranger', isPreferred: true, confidence: 'LOW' }],
      },
      { treeId: other.id, actorId: null },
    );

    await expect(
      createEvent(
        db,
        { type: 'CENSUS', participants: [{ personId: outsider.personId, role: 'PRINCIPAL' }] },
        ctx,
      ),
    ).rejects.toThrow(/introuvable/);

    await db.tree.delete({ where: { id: other.id } });
  });

  it('refuses a custom event with no name', async () => {
    const subject = await person('Sans', 'Intitulé');
    await expect(
      createEvent(
        db,
        { type: 'CUSTOM', participants: [{ personId: subject.personId, role: 'PRINCIPAL' }] },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it('moves the lifespan when a baptism stands in for a missing birth', async () => {
    // A baptism is not a birth, but for most of the parish-register era it is
    // the only thing written down, and refusing to place the person because
    // the exact word is missing would empty the timeline.
    const subject = await person('Baptisé', 'Sansnaissance');
    await createEvent(
      db,
      {
        type: 'BAPTISM',
        date: '3 FEB 1703',
        participants: [{ personId: subject.personId, role: 'PRINCIPAL' }],
      },
      ctx,
    );

    const row = await db.person.findUniqueOrThrow({
      where: { id: subject.personId },
      select: { lifespanEarliestJdn: true },
    });
    expect(row.lifespanEarliestJdn).not.toBeNull();
    expect(row.lifespanEarliestJdn).toBeLessThanOrEqual(gregorianToJdn(1703, 2, 3));
  });

  it('keeps an unreadable date and lowers the confidence rather than the record', async () => {
    const subject = await person('Recensé', 'Illisible');
    const event = await createEvent(
      db,
      {
        type: 'CENSUS',
        date: 'le 3e jour complémentaire',
        confidence: 'HIGH',
        participants: [{ personId: subject.personId, role: 'PRINCIPAL' }],
      },
      ctx,
    );

    const stored = await db.event.findUniqueOrThrow({
      where: { id: event.eventId },
      select: { dateUnparsed: true, dateOriginalText: true, confidence: true },
    });
    expect(stored.dateUnparsed).toBe(true);
    expect(stored.dateOriginalText).toBe('le 3e jour complémentaire');
    // The event happened; only its position is in doubt.
    expect(stored.confidence).toBe('LOW');
  });
});

describe('correcting and removing an event', () => {
  it('records what changed', async () => {
    const subject = await person('Corrigé', 'Événement');
    const event = await createEvent(
      db,
      {
        type: 'MIGRATION',
        date: '1888',
        participants: [{ personId: subject.personId, role: 'PRINCIPAL' }],
      },
      ctx,
    );

    await updateEvent(db, { eventId: event.eventId, date: '1889' }, ctx);

    const revision = await db.revision.findFirstOrThrow({
      where: { treeId, entityId: event.eventId, action: 'UPDATE' },
      select: { before: true, after: true },
    });
    expect(revision.before).toMatchObject({ dateOriginalText: '1888' });
    expect(revision.after).toMatchObject({ dateOriginalText: '1889' });
  });

  it('writes no revision when nothing actually changed', async () => {
    const subject = await person('Inchangé', 'Événement');
    const event = await createEvent(
      db,
      {
        type: 'OCCUPATION',
        description: 'tonnelier',
        participants: [{ personId: subject.personId, role: 'PRINCIPAL' }],
      },
      ctx,
    );

    await updateEvent(db, { eventId: event.eventId, description: 'tonnelier' }, ctx);

    const revisions = await db.revision.count({
      where: { treeId, entityId: event.eventId, action: 'UPDATE' },
    });
    expect(revisions).toBe(0);
  });

  it('moves the lifespan back when a baptism is removed', async () => {
    const subject = await person('Baptême', 'Retiré');
    const event = await createEvent(
      db,
      {
        type: 'BAPTISM',
        date: '1710',
        participants: [{ personId: subject.personId, role: 'PRINCIPAL' }],
      },
      ctx,
    );

    const before = await db.person.findUniqueOrThrow({
      where: { id: subject.personId },
      select: { lifespanEarliestJdn: true },
    });
    expect(before.lifespanEarliestJdn).not.toBeNull();

    await deleteEvent(db, event.eventId, ctx);

    const after = await db.person.findUniqueOrThrow({
      where: { id: subject.personId },
      select: { lifespanEarliestJdn: true },
    });
    // Leaving the cache in place would keep them on the timeline at a date
    // the tree no longer holds.
    expect(after.lifespanEarliestJdn).toBeNull();
  });

  it('removes softly, so the event can still be read back', async () => {
    const subject = await person('Supprimé', 'Doucement');
    const event = await createEvent(
      db,
      {
        type: 'RESIDENCE',
        placeName: 'Buenos Aires',
        participants: [{ personId: subject.personId, role: 'PRINCIPAL' }],
      },
      ctx,
    );

    await deleteEvent(db, event.eventId, ctx);

    const stored = await db.event.findUniqueOrThrow({
      where: { id: event.eventId },
      select: { deletedAt: true, placeOriginalText: true },
    });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.placeOriginalText).toBe('Buenos Aires');
  });

  it('clears an event date without deleting the event', async () => {
    const subject = await person('Date', 'Retirée');
    const event = await createEvent(
      db,
      {
        type: 'MILITARY_SERVICE',
        date: '1914',
        participants: [{ personId: subject.personId, role: 'PRINCIPAL' }],
      },
      ctx,
    );

    await updateEvent(db, { eventId: event.eventId, date: '' }, ctx);

    const stored = await db.event.findUniqueOrThrow({
      where: { id: event.eventId },
      select: { deletedAt: true, dateEarliestJdn: true, dateOriginalText: true },
    });
    expect(stored.deletedAt).toBeNull();
    expect(stored.dateEarliestJdn).toBeNull();
    expect(stored.dateOriginalText).toBe('');
  });
});

describe('the demonstration tree still reads correctly', () => {
  it('has a today that is a number, not a Date', async () => {
    // Guards a mistake that only shows up as an off-by-a-day at midnight.
    expect(typeof dateToJdn(new Date())).toBe('number');
  });
});
