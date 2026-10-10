import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createPerson,
  createRelationship,
  dismissDuplicate,
  mergePeople,
  openDuplicates,
  scanDuplicates,
  MergeRefused,
  UndoRefused,
  undoMerge,
  type Database,
} from '../src/index';

/**
 * Finding the same person twice, and making two records one.
 *
 * Against the real database, because the interesting parts are exactly the
 * ones a unit test cannot reach: the trigram search that decides which pairs
 * are even compared, and a merge that has to move participations, links and
 * claims without tripping a unique constraint.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let treeId: string;
const context = () => ({ treeId, actorId: null });

async function person(
  given: string,
  surname: string,
  fields: { birthDate?: string; birthPlace?: string; recordedSex?: 'MALE' | 'FEMALE' } = {},
): Promise<string> {
  const result = await createPerson(
    db,
    {
      names: [{ type: 'BIRTH', given, surname, isPreferred: true }],
      recordedSex: fields.recordedSex ?? 'MALE',
      ...(fields.birthDate ? { birthDate: fields.birthDate } : {}),
      ...(fields.birthPlace ? { birthPlace: fields.birthPlace } : {}),
    },
    context(),
  );
  return result.personId;
}

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });
  const tree = await db.tree.create({
    data: {
      name: 'Doublons',
      slug: `duplicates-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
  treeId = tree.id;
}, 60_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('scanning a tree', () => {
  let twinA = '';
  let twinB = '';

  it('brings together two records of one person, and leaves the rest alone', async () => {
    twinA = await person('Jean', 'Chassagne', { birthDate: '12 juin 1820', birthPlace: 'Tours' });
    twinB = await person('Jean', 'Chassaigne', { birthDate: '1821', birthPlace: 'Tours' });
    // A son of the same name, born a generation later: the classic trap.
    const son = await person('Jean', 'Chassagne', { birthDate: '1850', birthPlace: 'Tours' });
    await createRelationship(
      db,
      { sourceId: twinA, targetId: son, type: 'PARENT_BIOLOGICAL' },
      context(),
    );
    // And a woman with the same surname.
    await person('Marie', 'Chassagne', { birthDate: '1822', recordedSex: 'FEMALE' });

    const scan = await scanDuplicates(db, { treeId });
    expect(scan.examined).toBeGreaterThan(0);
    expect(scan.found).toBe(1);
    expect(scan.recorded).toBe(1);

    const open = await openDuplicates(db, treeId);
    expect(open).toHaveLength(1);
    const pair = [open[0]?.left.id, open[0]?.right.id].sort();
    expect(pair).toEqual([twinA, twinB].sort());
    expect(open[0]?.score).toBeGreaterThan(0.62);
    // The explanation says which signals produced the score.
    expect(JSON.stringify(open[0]?.explanation)).toContain('surname');
  });

  it('records one row per pair, however many times it runs', async () => {
    await scanDuplicates(db, { treeId });
    await scanDuplicates(db, { treeId });
    expect(await db.duplicateCandidate.count({ where: { treeId } })).toBe(1);
  });

  it('stops proposing a pair a human has answered', async () => {
    const [open] = await openDuplicates(db, treeId);
    await dismissDuplicate(db, { treeId, candidateId: open?.id ?? '' });
    expect(await openDuplicates(db, treeId)).toHaveLength(0);

    await scanDuplicates(db, { treeId });
    expect(await openDuplicates(db, treeId)).toHaveLength(0);
    expect(await db.duplicateCandidate.count({ where: { treeId, status: 'DISMISSED' } })).toBe(1);
  });
});

describe('merging two records', () => {
  it('moves everything the retired record carried, and keeps one person', async () => {
    const keep = await person('Étienne', 'Marchand', {
      birthDate: '3 mars 1801',
      birthPlace: 'Tours',
    });
    const merge = await person('Étienne', 'Marchand', { birthDate: '1801', birthPlace: 'Tours' });
    const child = await person('Louis', 'Marchand', { birthDate: '1830' });
    const spouse = await person('Anne', 'Girard', { birthDate: '1805', recordedSex: 'FEMALE' });

    // The retired record carries the child and the marriage.
    await createRelationship(
      db,
      { sourceId: merge, targetId: child, type: 'PARENT_BIOLOGICAL' },
      context(),
    );
    await createRelationship(db, { sourceId: merge, targetId: spouse, type: 'SPOUSE' }, context());
    // And both records share one link, which must not be written twice.
    await createRelationship(db, { sourceId: keep, targetId: spouse, type: 'SPOUSE' }, context());

    const result = await mergePeople(
      db,
      { treeId, keepId: keep, mergeId: merge },
      { actorId: null },
    );
    expect(result.keptId).toBe(keep);
    // The child's link moved; the duplicated marriage was dropped.
    expect(result.relationships).toBe(1);

    const survivor = await db.person.findUniqueOrThrow({
      where: { id: keep },
      select: { deletedAt: true, lifespanEarliestJdn: true },
    });
    expect(survivor.deletedAt).toBeNull();
    expect(survivor.lifespanEarliestJdn).not.toBeNull();
    expect((await db.person.findUniqueOrThrow({ where: { id: merge } })).deletedAt).not.toBeNull();

    // The child now has exactly one father, and it is the kept record.
    const parents = await db.relationship.findMany({
      where: { treeId, targetId: child, deletedAt: null },
      select: { sourceId: true },
    });
    expect(parents).toEqual([{ sourceId: keep }]);

    // One marriage, not two.
    expect(
      await db.relationship.count({ where: { treeId, type: 'SPOUSE', deletedAt: null } }),
    ).toBe(1);

    // Both births are kept: the merge does not choose between two dates.
    const births = await db.eventParticipant.count({
      where: { personId: keep, event: { type: 'BIRTH', deletedAt: null } },
    });
    expect(births).toBe(2);

    // And the history says what happened.
    const revision = await db.revision.findFirst({
      where: { treeId, action: 'MERGE' },
      select: { summary: true, entityId: true },
    });
    expect(revision?.entityId).toBe(keep);
    expect(revision?.summary).toContain('fusionné dans');
  });

  it('refuses a record that is not in the tree, and a record with itself', async () => {
    const someone = await person('Paul', 'Renard');
    await expect(
      mergePeople(db, { treeId, keepId: someone, mergeId: someone }, { actorId: null }),
    ).rejects.toBeInstanceOf(MergeRefused);
    await expect(
      mergePeople(
        db,
        { treeId, keepId: someone, mergeId: '00000000-0000-7000-8000-000000000000' },
        { actorId: null },
      ),
    ).rejects.toBeInstanceOf(MergeRefused);
  });

  it('answers the pairs that named the retired record', async () => {
    const keep = await person('Hippolyte', 'Vasseur', { birthDate: '1840' });
    const merge = await person('Hippolyte', 'Vasseur', { birthDate: '1840' });
    await scanDuplicates(db, { treeId });
    expect(
      await db.duplicateCandidate.count({ where: { treeId, status: 'OPEN' } }),
    ).toBeGreaterThan(0);

    await mergePeople(db, { treeId, keepId: keep, mergeId: merge }, { actorId: null });
    const rows = await db.duplicateCandidate.findMany({
      where: { treeId, OR: [{ leftId: merge }, { rightId: merge }] },
      select: { status: true },
    });
    expect(rows.every((row) => row.status === 'MERGED')).toBe(true);
    expect(await openDuplicates(db, treeId)).toHaveLength(0);
  });

  it('keeps a claim about a link both records had, instead of deleting it with the link', async () => {
    const parent = await person('Louis', 'Vasseur', { birthDate: '1800' });
    const keep = await person('Adèle', 'Vasseur', { birthDate: '1830', recordedSex: 'FEMALE' });
    const merge = await person('Adèle', 'Vasseur', { birthDate: '1830', recordedSex: 'FEMALE' });
    await createRelationship(
      db,
      { sourceId: parent, targetId: keep, type: 'PARENT_BIOLOGICAL' },
      context(),
    );
    await createRelationship(
      db,
      { sourceId: parent, targetId: merge, type: 'PARENT_BIOLOGICAL' },
      context(),
    );
    const doomed = await db.relationship.findFirstOrThrow({
      where: { sourceId: parent, targetId: merge },
      select: { id: true },
    });
    const claim = await db.claim.create({
      data: {
        treeId,
        relationshipId: doomed.id,
        predicate: 'PARENT',
        value: { text: 'Louis' },
        valueText: 'Louis',
        status: 'ACCEPTED',
      },
      select: { id: true },
    });

    await mergePeople(db, { treeId, keepId: keep, mergeId: merge }, { actorId: null });
    const survivor = await db.relationship.findFirstOrThrow({
      where: { sourceId: parent, targetId: keep },
      select: { id: true },
    });
    // Before this fix the claim was deleted by the cascade on the link.
    expect((await db.claim.findUniqueOrThrow({ where: { id: claim.id } })).relationshipId).toBe(
      survivor.id,
    );
  });

  it('undoes a merge exactly, once', async () => {
    const parent = await person('Pierre', 'Lemaire', { birthDate: '1790' });
    const keep = await person('Jean', 'Lemaire', { birthDate: '1822', birthPlace: 'Tours' });
    const merge = await person('Jean', 'Lemaire', { birthDate: '1822', birthPlace: 'Saché' });
    const child = await person('Paul', 'Lemaire', { birthDate: '1850' });
    await createRelationship(
      db,
      { sourceId: parent, targetId: keep, type: 'PARENT_BIOLOGICAL' },
      context(),
    );
    await createRelationship(
      db,
      { sourceId: parent, targetId: merge, type: 'PARENT_BIOLOGICAL' },
      context(),
    );
    await createRelationship(
      db,
      { sourceId: merge, targetId: child, type: 'PARENT_BIOLOGICAL' },
      context(),
    );
    const mergedNames = await db.personName.count({ where: { personId: merge } });
    const mergedRoles = await db.eventParticipant.count({ where: { personId: merge } });

    await mergePeople(db, { treeId, keepId: keep, mergeId: merge }, { actorId: null });
    const revision = await db.revision.findFirstOrThrow({
      where: { treeId, action: 'MERGE', entityId: keep },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const result = await undoMerge(db, { treeId, revisionId: revision.id }, { actorId: null });
    expect(result).toEqual({ restoredId: merge, keptId: keep });

    // The record is back, with its own names, events and links.
    expect((await db.person.findUniqueOrThrow({ where: { id: merge } })).deletedAt).toBeNull();
    expect(await db.personName.count({ where: { personId: merge } })).toBe(mergedNames);
    expect(await db.eventParticipant.count({ where: { personId: merge } })).toBe(mergedRoles);
    expect(await db.relationship.count({ where: { sourceId: merge, targetId: child } })).toBe(1);
    // The link the merge deleted as a duplicate is recreated.
    expect(await db.relationship.count({ where: { sourceId: parent, targetId: merge } })).toBe(1);
    // The kept record still has its own, and only its own.
    expect(await db.relationship.count({ where: { sourceId: parent, targetId: keep } })).toBe(1);
    expect(await db.relationship.count({ where: { sourceId: keep, targetId: child } })).toBe(0);

    await expect(
      undoMerge(db, { treeId, revisionId: revision.id }, { actorId: null }),
    ).rejects.toBeInstanceOf(UndoRefused);
  });
});
