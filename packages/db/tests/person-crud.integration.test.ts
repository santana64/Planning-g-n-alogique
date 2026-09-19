import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dateToJdn, gregorianToJdn, isPresumedLiving } from '@chronolignee/domain';
import {
  RelationshipRefused,
  createCitation,
  createDatabase,
  createPerson,
  createSource,
  createRelationship,
  deletePerson,
  deleteRelationship,
  loadGenealogyGraph,
  updatePerson,
  type Database,
} from '../src/index';

/**
 * The manual write path.
 *
 * Every assertion here is about something the write must do beyond inserting a
 * row: parse a date through the domain, create the vital event rather than a
 * column, refresh the derived cache, record who did it, and refuse the one
 * kind of edit that would corrupt the graph.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const TODAY_JDN = dateToJdn(new Date());

let db: Database;
let treeId: string;
let ctx: { treeId: string; actorId: string | null };

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const tree = await db.tree.create({
    data: { name: 'CRUD', slug: `crud-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  treeId = tree.id;
  ctx = { treeId, actorId: null };
}, 60_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

async function person(given: string, surname: string, birth?: string, death?: string) {
  return createPerson(
    db,
    {
      recordedSex: 'UNKNOWN',
      livingStatus: death ? 'DECEASED' : 'UNKNOWN',
      names: [{ type: 'BIRTH', given, surname, isPreferred: true, confidence: 'MEDIUM' }],
      ...(birth ? { birthDate: birth } : {}),
      ...(death ? { deathDate: death } : {}),
    },
    ctx,
  );
}

describe('creating a person', () => {
  it('builds the display name in the French convention', async () => {
    const created = await person('Jean', 'Dupont');
    // Surname in caps is not decoration: in "Jean MARTIN Pierre" it is the
    // only thing telling a reader which token is the family name.
    expect(created.displayName).toBe('Jean DUPONT');
  });

  it('stores the birth as an event, not as a column', async () => {
    const created = await person('Marie', 'Martin', '12 JUN 1877');

    const events = await db.event.findMany({
      where: { treeId, participants: { some: { personId: created.personId } } },
      select: { type: true, dateOriginalText: true, dateEarliestJdn: true },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('BIRTH');
    expect(events[0]?.dateEarliestJdn).toBe(gregorianToJdn(1877, 6, 12));
  });

  it('parses a French date typed into the form', async () => {
    const created = await person('Pierre', 'Durand', '12 juin 1877');
    const row = await db.person.findUniqueOrThrow({
      where: { id: created.personId },
      select: { lifespanEarliestJdn: true },
    });
    expect(row.lifespanEarliestJdn).toBe(gregorianToJdn(1877, 6, 12));
  });

  it('keeps a date it cannot read, without inventing a position', async () => {
    const created = await person('Léonie', 'Blanchard', '9 br 1889');

    const event = await db.event.findFirstOrThrow({
      where: { treeId, type: 'BIRTH', participants: { some: { personId: created.personId } } },
      select: { dateOriginalText: true, dateUnparsed: true, dateEarliestJdn: true },
    });
    expect(event.dateOriginalText).toBe('9 br 1889');
    expect(event.dateUnparsed).toBe(true);
    expect(event.dateEarliestJdn).toBeNull();
  });

  it('fills the derived lifespan on the way in', async () => {
    // The Gantt reads the cache, so a write that skipped it would put the
    // person nowhere on the timeline.
    const created = await person('Auguste', 'Bonnet', '1843', '1910');
    const row = await db.person.findUniqueOrThrow({
      where: { id: created.personId },
      select: { lifespanEarliestJdn: true, lifespanLatestJdn: true, birthSortJdn: true },
    });
    expect(row.lifespanEarliestJdn).not.toBeNull();
    expect(row.lifespanLatestJdn).not.toBeNull();
    expect(row.birthSortJdn).toBe(row.lifespanEarliestJdn);
  });

  it('redacts a living person from the moment they exist', async () => {
    const created = await createPerson(
      db,
      {
        recordedSex: 'FEMALE',
        livingStatus: 'LIVING',
        names: [
          {
            type: 'BIRTH',
            given: 'Claire',
            surname: 'Vasseur',
            isPreferred: true,
            confidence: 'HIGH',
          },
        ],
        birthDate: '1980',
      },
      ctx,
    );
    const row = await db.person.findUniqueOrThrow({
      where: { id: created.personId },
      select: { privacy: true },
    });
    // Never briefly public between being created and being protected.
    expect(row.privacy).toBe('REDACTED');
  });

  it('refuses a person with no name at all', async () => {
    await expect(
      createPerson(db, { recordedSex: 'UNKNOWN', livingStatus: 'UNKNOWN', names: [] }, ctx),
    ).rejects.toThrow();
  });

  it('records who created them', async () => {
    const created = await person('Odette', 'Moreau');
    const revision = await db.revision.findFirstOrThrow({
      where: { treeId, entityId: created.personId, action: 'CREATE' },
      select: { summary: true, after: true },
    });
    expect(revision.summary).toContain('Odette MOREAU');
  });

  it('bumps the tree revision, so a cached layout cannot be served stale', async () => {
    const before = await db.tree.findUniqueOrThrow({
      where: { id: treeId },
      select: { revision: true },
    });
    await person('Hippolyte', 'Chassagne');
    const after = await db.tree.findUniqueOrThrow({
      where: { id: treeId },
      select: { revision: true },
    });
    expect(after.revision).toBeGreaterThan(before.revision);
  });
});

describe('editing a person', () => {
  it('replaces a corrected date and keeps the previous one on the record', async () => {
    const created = await person('Jean-Baptiste', 'Chassagne', '1823');
    await updatePerson(db, { personId: created.personId, birthDate: '6 JUN 1822' }, ctx);

    const events = await db.event.findMany({
      where: { treeId, type: 'BIRTH', participants: { some: { personId: created.personId } } },
      select: { dateOriginalText: true, deletedAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // The correction is a fact about the research; the value that was there
    // before is exactly what someone will want if the correction is wrong.
    expect(events).toHaveLength(2);
    expect(events[0]?.deletedAt).not.toBeNull();
    expect(events[1]?.deletedAt).toBeNull();
    expect(events[1]?.dateOriginalText).toBe('6 JUN 1822');
  });

  it('moves the lifespan when the date moves', async () => {
    const created = await person('Victoire', 'Marchand', '1798');
    await updatePerson(db, { personId: created.personId, birthDate: '19 JUL 1799' }, ctx);

    const row = await db.person.findUniqueOrThrow({
      where: { id: created.personId },
      select: { lifespanEarliestJdn: true },
    });
    expect(row.lifespanEarliestJdn).toBe(gregorianToJdn(1799, 7, 19));
  });

  it('leaves the archived date out of the graph the views are drawn from', async () => {
    // The archived event stays in the record, and must stay out of every
    // projection: the fan, the ancestry and the validation all read the graph,
    // and would otherwise place someone at a date the researcher corrected.
    const created = await person('Hippolyte', 'Vasseur', '1830');
    await updatePerson(db, { personId: created.personId, birthDate: '4 MAR 1835' }, ctx);

    const graph = await loadGenealogyGraph(db, treeId, TODAY_JDN);
    const birth = graph.people.get(created.personId)?.birth;
    expect(birth?.interval.earliest).toBe(gregorianToJdn(1835, 3, 4));
    expect(birth?.interval.latest).toBe(gregorianToJdn(1835, 3, 4));
  });

  it('keeps a sourced birth when the form is saved for something else', async () => {
    // The form always sends the vital fields. Replacing the birth on every
    // save archived the event its citations point at: correcting a note left
    // a sourced birth unsourced.
    const created = await person('Rosalie', 'Chassagne', '12 JUN 1877');
    const birth = await db.event.findFirstOrThrow({
      where: {
        treeId,
        type: 'BIRTH',
        deletedAt: null,
        participants: { some: { personId: created.personId } },
      },
      select: { id: true },
    });
    const source = await createSource(db, { title: 'Registre des naissances, Tours, 1877' }, ctx);
    await createCitation(
      db,
      { sourceId: source.sourceId, locator: 'acte 412', eventId: birth.id },
      ctx,
    );

    await updatePerson(
      db,
      {
        personId: created.personId,
        birthDate: '12 JUN 1877',
        birthPlace: '',
        deathDate: '',
        deathPlace: '',
        notes: 'Chercher le mariage.',
      },
      ctx,
    );

    const births = await db.event.findMany({
      where: {
        treeId,
        type: 'BIRTH',
        deletedAt: null,
        participants: { some: { personId: created.personId } },
      },
      select: { id: true, _count: { select: { citations: true } } },
    });
    expect(births).toEqual([{ id: birth.id, _count: { citations: 1 } }]);
  });

  it('hands the privacy rule a recorded death, not an inferred one', async () => {
    // A GEDCOM import leaves most people UNKNOWN. Whether such a person is
    // presumed living depends on a death having been recorded, which the
    // lifespan columns alone cannot say: the maximum-lifespan rule gives a
    // man born in 1990 an "end" too.
    const recent = await person('Noé', 'Brunel', '1990');
    const dead = await createPerson(
      db,
      {
        recordedSex: 'UNKNOWN',
        livingStatus: 'UNKNOWN',
        names: [
          {
            type: 'BIRTH',
            given: 'Ange',
            surname: 'Brunel',
            isPreferred: true,
            confidence: 'MEDIUM',
          },
        ],
        birthDate: '1990',
        deathDate: '2019',
      },
      ctx,
    );

    const graph = await loadGenealogyGraph(db, treeId, TODAY_JDN);
    const subject = (id: string) => {
      const found = graph.people.get(id);
      return {
        livingStatus: found?.livingStatus ?? 'UNKNOWN',
        privacy: found?.privacy ?? 'INHERIT',
        birthEarliestJdn: found?.birth?.interval.earliest ?? null,
        deathRecorded: found?.deathRecorded ?? false,
      };
    };

    expect(subject(recent.personId)).toMatchObject({ privacy: 'INHERIT', deathRecorded: false });
    expect(isPresumedLiving(subject(recent.personId), TODAY_JDN)).toBe(true);
    expect(subject(dead.personId).deathRecorded).toBe(true);
    expect(isPresumedLiving(subject(dead.personId), TODAY_JDN)).toBe(false);
  });

  it('records what changed, not the whole row', async () => {
    const created = await person('Rosalie', 'Dubois');
    await updatePerson(db, { personId: created.personId, recordedSex: 'FEMALE' }, ctx);

    const revision = await db.revision.findFirstOrThrow({
      where: { treeId, entityId: created.personId, action: 'UPDATE' },
      select: { before: true, after: true },
    });
    expect(revision.after).toMatchObject({ recordedSex: 'FEMALE' });
    expect(Object.keys(revision.after as object)).toHaveLength(1);
  });

  it('records a corrected birth as the form showed it, before and after', async () => {
    // "Noah changed the birth date from 1877 to 1878" needs both values in
    // the revision: the archived event is not something the history re-reads.
    const created = await person('Amand', 'Delorme', '1877');
    await updatePerson(
      db,
      { personId: created.personId, birthDate: '1878', birthPlace: 'Tours' },
      { ...ctx, actorId: null },
    );

    const revision = await db.revision.findFirstOrThrow({
      where: { treeId, entityId: created.personId, action: 'UPDATE' },
      select: { before: true, after: true },
    });
    expect(revision.before).toEqual({ birthDate: '1877', birthPlace: null });
    expect(revision.after).toEqual({ birthDate: '1878', birthPlace: 'Tours' });
  });

  it('keeps a publication decision when only the status changes', async () => {
    // An administrator published this person deliberately; recording a death
    // must not quietly undo a choice only an administrator could make.
    const created = await createPerson(
      db,
      {
        livingStatus: 'LIVING',
        privacy: 'VISIBLE',
        names: [{ type: 'BIRTH', given: 'Lucien', surname: 'Arnaud', isPreferred: true }],
      },
      ctx,
    );
    await updatePerson(db, { personId: created.personId, livingStatus: 'DECEASED' }, ctx);
    const published = await db.person.findUniqueOrThrow({
      where: { id: created.personId },
      select: { privacy: true },
    });
    expect(published.privacy).toBe('VISIBLE');

    // Without such a decision, the status carries its default with it.
    const plain = await person('Mathilde', 'Arnaud');
    await updatePerson(db, { personId: plain.personId, livingStatus: 'LIVING' }, ctx);
    const redacted = await db.person.findUniqueOrThrow({
      where: { id: plain.personId },
      select: { privacy: true },
    });
    expect(redacted.privacy).toBe('REDACTED');

    // The form sends the setting back with every save. Sent unchanged, it is
    // not a choice, and the new status still carries its default.
    const resubmitted = await person('Gustave', 'Arnaud');
    await updatePerson(
      db,
      { personId: resubmitted.personId, livingStatus: 'LIVING', privacy: 'INHERIT' },
      ctx,
    );
    const followed = await db.person.findUniqueOrThrow({
      where: { id: resubmitted.personId },
      select: { privacy: true },
    });
    expect(followed.privacy).toBe('REDACTED');
  });

  it('writes no revision when nothing actually changed', async () => {
    const created = await person('Céline', 'Moreau');
    await updatePerson(db, { personId: created.personId, recordedSex: 'UNKNOWN' }, ctx);

    const revisions = await db.revision.count({
      where: { treeId, entityId: created.personId, action: 'UPDATE' },
    });
    expect(revisions).toBe(0);
  });

  it('does not un-redact a living person when something unrelated is edited', async () => {
    // The regression this guards: `.partial()` in Zod keeps a field's default,
    // so an update schema derived from one defaulting livingStatus to UNKNOWN
    // silently reset it on every edit — and privacy follows living status.
    // Correcting a living person's surname would have made them public.
    const created = await createPerson(
      db,
      {
        recordedSex: 'FEMALE',
        livingStatus: 'LIVING',
        names: [
          {
            type: 'BIRTH',
            given: 'Vivante',
            surname: 'Avant',
            isPreferred: true,
            confidence: 'HIGH',
          },
        ],
        birthDate: '1985',
      },
      ctx,
    );

    await updatePerson(
      db,
      {
        personId: created.personId,
        names: [
          {
            type: 'BIRTH',
            given: 'Vivante',
            surname: 'Après',
            isPreferred: true,
            confidence: 'HIGH',
          },
        ],
      },
      ctx,
    );

    const row = await db.person.findUniqueOrThrow({
      where: { id: created.personId },
      select: { livingStatus: true, privacy: true, displayName: true },
    });

    expect(row.displayName).toBe('Vivante APRÈS');
    expect(row.livingStatus).toBe('LIVING');
    expect(row.privacy).toBe('REDACTED');
  });

  it('reuses a place already spelled the same way', async () => {
    // Two people born in "Tours" must not create two towns, which would split
    // the same place across a map.
    const a = await createPerson(
      db,
      {
        recordedSex: 'UNKNOWN',
        livingStatus: 'UNKNOWN',
        names: [
          { type: 'BIRTH', given: 'A', surname: 'X', isPreferred: true, confidence: 'MEDIUM' },
        ],
        birthDate: '1800',
        birthPlace: 'Tours',
      },
      ctx,
    );
    await createPerson(
      db,
      {
        recordedSex: 'UNKNOWN',
        livingStatus: 'UNKNOWN',
        names: [
          { type: 'BIRTH', given: 'B', surname: 'X', isPreferred: true, confidence: 'MEDIUM' },
        ],
        birthDate: '1802',
        birthPlace: 'tours',
      },
      ctx,
    );

    expect(a.personId).toBeTruthy();
    expect(await db.place.count({ where: { treeId, normalisedName: 'tours' } })).toBe(1);
  });
});

describe('relationships', () => {
  it('links a parent to a child', async () => {
    const parent = await person('Étienne', 'Chassagne', '1762', '1834');
    const child = await person('Pierre', 'Chassagne', '1799', '1857');

    const result = await createRelationship(
      db,
      {
        sourceId: parent.personId,
        targetId: child.personId,
        type: 'PARENT_BIOLOGICAL',
        confidence: 'HIGH',
      },
      ctx,
    );
    expect(result.relationshipId).toBeTruthy();
    expect(result.warnings).toEqual([]);
  });

  it('refuses an edge that would make someone their own ancestor', async () => {
    const a = await person('Boucle', 'Un', '1800');
    const b = await person('Boucle', 'Deux', '1830');

    await createRelationship(
      db,
      { sourceId: a.personId, targetId: b.personId, type: 'PARENT_BIOLOGICAL', confidence: 'HIGH' },
      ctx,
    );

    // The one kind of edit that must be refused: every traversal downstream
    // assumes the graph is acyclic.
    await expect(
      createRelationship(
        db,
        {
          sourceId: b.personId,
          targetId: a.personId,
          type: 'PARENT_BIOLOGICAL',
          confidence: 'HIGH',
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(RelationshipRefused);

    const graph = await loadGenealogyGraph(db, treeId, TODAY_JDN);
    expect(graph.findCycles()).toEqual([]);
  });

  it('refuses a person as their own parent', async () => {
    const self = await person('Solo', 'Test');
    await expect(
      createRelationship(
        db,
        {
          sourceId: self.personId,
          targetId: self.personId,
          type: 'PARENT_BIOLOGICAL',
          confidence: 'HIGH',
        },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it('accepts an unusual record and returns the warning instead of blocking', async () => {
    // A mother of 58 is what the register says. Refusing it would force the
    // researcher to falsify the record in order to store it.
    const mother = await createPerson(
      db,
      {
        recordedSex: 'FEMALE',
        livingStatus: 'DECEASED',
        names: [
          {
            type: 'BIRTH',
            given: 'Victoire',
            surname: 'Âgée',
            isPreferred: true,
            confidence: 'HIGH',
          },
        ],
        birthDate: '19 JUL 1798',
        deathDate: '1869',
      },
      ctx,
    );
    const child = await person('Hippolyte', 'Tardif', '2 FEB 1856', '1921');

    const result = await createRelationship(
      db,
      {
        sourceId: mother.personId,
        targetId: child.personId,
        type: 'PARENT_BIOLOGICAL',
        confidence: 'MEDIUM',
      },
      ctx,
    );

    expect(result.relationshipId).toBeTruthy();
    expect(result.warnings.map((w) => w.code)).toContain('MOTHER_TOO_OLD');
    expect(result.warnings.every((w) => w.severity !== 'ERROR')).toBe(true);
  });

  it('lets a child have a biological and an adoptive parent at once', async () => {
    const bio = await person('Bio', 'Parent', '1900');
    const adoptive = await person('Adoptif', 'Parent', '1898');
    const child = await person('Enfant', 'Deux', '1930');

    await createRelationship(
      db,
      {
        sourceId: bio.personId,
        targetId: child.personId,
        type: 'PARENT_BIOLOGICAL',
        confidence: 'HIGH',
      },
      ctx,
    );
    await createRelationship(
      db,
      {
        sourceId: adoptive.personId,
        targetId: child.personId,
        type: 'PARENT_ADOPTIVE',
        confidence: 'HIGH',
      },
      ctx,
    );

    const graph = await loadGenealogyGraph(db, treeId, TODAY_JDN);
    expect(graph.parentsOf(child.personId)).toHaveLength(2);
    expect(graph.parentsOf(child.personId, true)).toHaveLength(1);
  });

  it('removes a link without removing the people', async () => {
    const parent = await person('Lien', 'Parent', '1900');
    const child = await person('Lien', 'Enfant', '1930');
    const link = await createRelationship(
      db,
      {
        sourceId: parent.personId,
        targetId: child.personId,
        type: 'PARENT_BIOLOGICAL',
        confidence: 'HIGH',
      },
      ctx,
    );

    await deleteRelationship(db, link.relationshipId, ctx);

    const graph = await loadGenealogyGraph(db, treeId, TODAY_JDN);
    expect(graph.has(parent.personId)).toBe(true);
    expect(graph.parentsOf(child.personId)).toHaveLength(0);
  });
});

describe('deletion', () => {
  it('keeps the row and its events, and takes the links with it', async () => {
    const parent = await person('Suppr', 'Parent', '1900');
    const child = await person('Suppr', 'Enfant', '1930');
    await createRelationship(
      db,
      {
        sourceId: parent.personId,
        targetId: child.personId,
        type: 'PARENT_BIOLOGICAL',
        confidence: 'HIGH',
      },
      ctx,
    );

    await deletePerson(db, parent.personId, ctx);

    // A deletion is routinely a mistake discovered weeks later; a hard delete
    // would have taken the events and citations too.
    const row = await db.person.findUniqueOrThrow({
      where: { id: parent.personId },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();

    const graph = await loadGenealogyGraph(db, treeId, TODAY_JDN);
    expect(graph.has(parent.personId)).toBe(false);
    // A link to someone nobody can see would render as a line into nothing.
    expect(graph.parentsOf(child.personId)).toHaveLength(0);
  });
});
