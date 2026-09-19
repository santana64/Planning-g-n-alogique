import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@chronolignee/db';
import { runGedcomImport } from '../src/gedcom-import';

/**
 * The worker's half of an import, against the real database.
 *
 * What matters here is less the writing — the db package's own tests cover
 * that — than the job row around it: that it moves from queued to running to
 * done in step with the data, that it counts real rows as it goes, that a job
 * nobody queued writes nothing, and that a job run twice writes once.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const FILE = new TextEncoder().encode(
  [
    '0 HEAD',
    '1 GEDC',
    '2 VERS 7.0',
    '0 @I1@ INDI',
    '1 NAME Étienne /CHASSAGNE/',
    '1 BIRT',
    '2 DATE 11 MAY 1762',
    '1 FAMS @F1@',
    '0 @I2@ INDI',
    '1 NAME Jeanne /LEFÈVRE/',
    '1 FAMS @F1@',
    '0 @I3@ INDI',
    '1 NAME Pierre /CHASSAGNE/',
    '1 FAMC @F1@',
    '0 @F1@ FAM',
    '1 HUSB @I1@',
    '1 WIFE @I2@',
    '1 CHIL @I3@',
    '0 TRLR',
  ].join('\n'),
);

/** The same file in a DOS code page, which the import refuses rather than garble. */
const DOS_FILE = new Uint8Array([
  ...new TextEncoder().encode('0 HEAD\n1 CHAR IBMPC\n0 @I1@ INDI\n1 NAME Honor'),
  0x82,
  ...new TextEncoder().encode(' /LEFEVRE/\n0 TRLR\n'),
]);

let db: Database;
let treeId: string;
const files = new Map<string, Uint8Array>([
  ['imports/good.ged', FILE],
  ['imports/dos.ged', DOS_FILE],
]);
const read = async (key: string): Promise<Uint8Array> => {
  const bytes = files.get(key);
  if (!bytes) throw new Error(`no such object: ${key}`);
  return bytes;
};

async function analysedJob(storageKey: string, status: 'COMPLETED' | 'QUEUED'): Promise<string> {
  const job = await db.importJob.create({
    data: {
      treeId,
      originalFilename: storageKey,
      byteSize: 1,
      storageKey,
      isDryRun: true,
      status,
    },
  });
  return job.id;
}

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });
  const tree = await db.tree.create({
    data: {
      name: 'Import par le worker',
      slug: `worker-import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
  treeId = tree.id;
}, 60_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('a queued import', () => {
  it('is written, counted as it goes, and marked done with the data', async () => {
    const importJobId = await analysedJob('imports/good.ged', 'QUEUED');
    const result = await runGedcomImport(
      { db, read, progressEveryMs: 0 },
      { treeId, importJobId, storageKey: 'imports/good.ged', actorId: null },
    );

    expect(result?.people).toBe(3);
    expect(await db.person.count({ where: { treeId } })).toBe(3);

    const job = await db.importJob.findUniqueOrThrow({ where: { id: importJobId } });
    expect(job.status).toBe('COMPLETED');
    expect(job.isDryRun).toBe(false);
    // Real rows: three people, three names, one birth and its participant,
    // three parent links and the union.
    expect(job.totalRecords).toBeGreaterThan(3);
    expect(job.processedRecords).toBe(job.totalRecords);
    expect(job.result).toMatchObject({ people: 3, relationships: 3, rejected: [] });

    // The history entry carries the job's id.
    const revision = await db.revision.findFirst({ where: { treeId, action: 'IMPORT' } });
    expect(revision?.batchId).toBe(importJobId);
  });

  it('is written once, however many times the queue delivers it', async () => {
    const importJobId = await db.importJob
      .findFirstOrThrow({ where: { treeId, isDryRun: false } })
      .then((job) => job.id);
    const again = await runGedcomImport(
      { db, read },
      { treeId, importJobId, storageKey: 'imports/good.ged', actorId: null },
    );
    expect(again).toBeNull();
    expect(await db.person.count({ where: { treeId } })).toBe(3);
  });
});

describe('an import nobody queued', () => {
  it('writes nothing — the job the request gave up on, arriving late', async () => {
    const importJobId = await analysedJob('imports/good.ged', 'COMPLETED');
    const result = await runGedcomImport(
      { db, read },
      { treeId, importJobId, storageKey: 'imports/good.ged', actorId: null },
    );
    expect(result).toBeNull();
    expect(await db.person.count({ where: { treeId } })).toBe(3);
    const job = await db.importJob.findUniqueOrThrow({ where: { id: importJobId } });
    expect(job).toMatchObject({ status: 'COMPLETED', isDryRun: true });
  });
});

describe('a file that cannot be read faithfully', () => {
  it('fails the job with a code and writes nothing', async () => {
    const importJobId = await analysedJob('imports/dos.ged', 'QUEUED');
    await expect(
      runGedcomImport(
        { db, read },
        { treeId, importJobId, storageKey: 'imports/dos.ged', actorId: null },
      ),
    ).rejects.toThrow('UNSUPPORTED_ENCODING');

    const job = await db.importJob.findUniqueOrThrow({ where: { id: importJobId } });
    expect(job).toMatchObject({ status: 'FAILED', isDryRun: true, error: 'UNSUPPORTED_ENCODING' });
    expect(await db.person.count({ where: { treeId } })).toBe(3);
  });
});
