import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { gregorianToJdn } from '@chronolignee/domain';
import {
  ResearchTaskNotFound,
  createDatabase,
  createPerson,
  createResearchTask,
  updateResearchTask,
  type Database,
} from '../src/index';

/**
 * Research tasks: a question, where to look, and what was found.
 *
 * What is asserted is what the write must do beyond inserting a row: read a
 * period as genealogists write it, refuse a person from another family, stamp
 * and clear the resolution date, and leave a trace in the history.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let treeId: string;
let otherTreeId: string;
let ctx: { treeId: string; actorId: string | null };

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  treeId = (await db.tree.create({ data: { name: 'Recherche', slug: `research-${suffix}` } })).id;
  otherTreeId = (
    await db.tree.create({ data: { name: 'Autre', slug: `research-other-${suffix}` } })
  ).id;
  ctx = { treeId, actorId: null };
}, 60_000);

afterAll(async () => {
  for (const id of [treeId, otherTreeId]) {
    if (id) await db.tree.delete({ where: { id } }).catch(() => undefined);
  }
  await db.$disconnect();
});

const person = (given: string, tree: string) =>
  createPerson(
    db,
    {
      recordedSex: 'MALE',
      livingStatus: 'DECEASED',
      names: [
        { type: 'BIRTH', given, surname: 'CHASSAGNE', isPreferred: true, confidence: 'MEDIUM' },
      ],
    },
    { treeId: tree, actorId: null },
  );

describe('opening a research task', () => {
  it('reads the period as a genealogist writes it, and records who asked', async () => {
    const jean = await person('Jean', treeId);
    const { id } = await createResearchTask(
      db,
      {
        title: 'Baptême de Jean',
        hypothesis: 'Baptisé à Azay-le-Rideau, comme ses frères',
        personId: jean.personId,
        priority: 'HIGH',
        repository: 'AD 37',
        searchFrom: 'ABT 1698',
        searchTo: '1710',
        url: 'https://archives.touraine.fr/',
      },
      ctx,
    );

    const task = await db.researchTask.findUniqueOrThrow({ where: { id } });
    expect(task.status).toBe('TODO');
    expect(task.priority).toBe('HIGH');
    expect(task.personId).toBe(jean.personId);
    // "About 1698" widens the start of the search, it does not narrow it.
    expect(task.searchFromJdn).toBeLessThan(gregorianToJdn(1698, 1, 1));
    expect(task.searchToJdn).toBe(gregorianToJdn(1710, 12, 31));

    const revision = await db.revision.findFirst({
      where: { treeId, entityType: 'ResearchTask', entityId: id, action: 'CREATE' },
    });
    expect(revision).not.toBeNull();
  });

  it('refuses a person who belongs to another family', async () => {
    const stranger = await person('Étranger', otherTreeId);
    await expect(
      createResearchTask(db, { title: 'Intrus', personId: stranger.personId }, ctx),
    ).rejects.toBeInstanceOf(ResearchTaskNotFound);
  });

  it('refuses a period that ends before it starts, and an unreadable date', async () => {
    await expect(
      createResearchTask(db, { title: 'À rebours', searchFrom: '1750', searchTo: '1700' }, ctx),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createResearchTask(db, { title: 'Illisible', searchFrom: 'vers la Saint-Martin' }, ctx),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses a link that is not a web address', async () => {
    await expect(
      createResearchTask(db, { title: 'Lien', url: 'javascript:alert(1)' }, ctx),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe('working a task', () => {
  it('keeps "nothing found" as a result, and reopening clears the resolution', async () => {
    const { id } = await createResearchTask(db, { title: 'Recensement 1836' }, ctx);

    await updateResearchTask(
      db,
      id,
      { status: 'RESOLVED', outcome: 'Rien dans le recensement de Saché, 1836.' },
      ctx,
    );
    const resolved = await db.researchTask.findUniqueOrThrow({ where: { id } });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.outcome).toBe('Rien dans le recensement de Saché, 1836.');
    expect(resolved.resolvedAt).not.toBeNull();

    await updateResearchTask(db, id, { status: 'IN_PROGRESS' }, ctx);
    const reopened = await db.researchTask.findUniqueOrThrow({ where: { id } });
    expect(reopened.resolvedAt).toBeNull();
    // The outcome was not sent, so it is kept rather than erased.
    expect(reopened.outcome).toBe('Rien dans le recensement de Saché, 1836.');

    const updates = await db.revision.count({
      where: { treeId, entityType: 'ResearchTask', entityId: id, action: 'UPDATE' },
    });
    expect(updates).toBe(2);
  });

  it('cannot reach a task of another tree', async () => {
    const elsewhere = await createResearchTask(
      db,
      { title: 'Ailleurs' },
      { treeId: otherTreeId, actorId: null },
    );
    await expect(
      updateResearchTask(db, elsewhere.id, { status: 'ABANDONED' }, ctx),
    ).rejects.toBeInstanceOf(ResearchTaskNotFound);
  });
});
