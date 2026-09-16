import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCitation,
  createDatabase,
  createEvent,
  createPerson,
  createSource,
  deleteCitation,
  findDocumentByChecksum,
  registerDocument,
  type Database,
} from '../src/index';

/**
 * Source, citation, and what they are attached to.
 *
 * The distinction most genealogy software collapses: a source is a thing in
 * the world, a citation is where inside it. "Archives d'Indre-et-Loire" as the
 * evidence for a birth date is not evidence, it is a building.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let treeId: string;
let ctx: { treeId: string; actorId: string | null };
let personId = '';
let eventId = '';

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const tree = await db.tree.create({
    data: { name: 'Evidence', slug: `ev-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  treeId = tree.id;
  ctx = { treeId, actorId: null };

  const person = await createPerson(
    db,
    {
      recordedSex: 'MALE',
      livingStatus: 'DECEASED',
      names: [
        {
          type: 'BIRTH',
          given: 'Jean-Baptiste',
          surname: 'Chassagne',
          isPreferred: true,
          confidence: 'HIGH',
        },
      ],
      birthDate: '12 JUN 1822',
    },
    ctx,
  );
  personId = person.personId;

  const event = await createEvent(
    db,
    { type: 'CENSUS', date: '1866', participants: [{ personId, role: 'PRINCIPAL' }] },
    ctx,
  );
  eventId = event.eventId;
}, 90_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

async function source(title: string, callNumber?: string) {
  return createSource(
    db,
    {
      title,
      type: 'PARISH_REGISTER',
      repository: 'Archives departementales Indre-et-Loire',
      ...(callNumber ? { callNumber } : {}),
      reliability: 'HIGH',
    },
    ctx,
  );
}

describe('sources', () => {
  it('keeps the call number, which is what lets anyone find it again', async () => {
    const created = await source('Registre paroissial de Tours 1820-1825', '6 NUM 7/261/003');
    const row = await db.source.findUniqueOrThrow({
      where: { id: created.sourceId },
      select: { callNumber: true, repository: true },
    });
    expect(row.callNumber).toBe('6 NUM 7/261/003');
    expect(row.repository).toContain('Indre-et-Loire');
  });

  it('records its own creation', async () => {
    const created = await source('Recensement de 1866');
    const revision = await db.revision.findFirstOrThrow({
      where: { treeId, entityId: created.sourceId, action: 'CREATE' },
      select: { summary: true },
    });
    expect(revision.summary).toContain('Recensement de 1866');
  });

  it('refuses a source with no title', async () => {
    await expect(createSource(db, { title: '   ' }, ctx)).rejects.toThrow();
  });
});

describe('citations', () => {
  it('attaches to an event with a locator, not just to a source', async () => {
    const created = await source('Registre de Tours', '6 NUM 7/261/004');
    const citation = await createCitation(
      db,
      {
        sourceId: created.sourceId,
        locator: 'vue 118, acte 7',
        quotation: 'ne le douzieme jour de juin',
        confidence: 'VERY_HIGH',
        eventId,
      },
      ctx,
    );

    const row = await db.citation.findUniqueOrThrow({
      where: { id: citation.citationId },
      select: { locator: true, quotation: true, eventId: true, confidence: true },
    });
    expect(row.locator).toBe('vue 118, acte 7');
    expect(row.eventId).toBe(eventId);
    expect(row.confidence).toBe('VERY_HIGH');
  });

  it('refuses a source from another tree', async () => {
    // Without the check a citation would point across archives and quietly
    // join two families that have nothing to do with each other.
    const other = await db.tree.create({
      data: { name: 'Ailleurs', slug: `oth-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    });
    const foreign = await createSource(
      db,
      { title: 'Ailleurs' },
      { treeId: other.id, actorId: null },
    );

    await expect(
      createCitation(db, { sourceId: foreign.sourceId, eventId }, ctx),
    ).rejects.toThrow();

    await db.tree.delete({ where: { id: other.id } });
  });

  it('refuses an event from another tree', async () => {
    const created = await source('Registre controle');
    const other = await db.tree.create({
      data: {
        name: 'Ailleurs2',
        slug: `oth2-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const otherPerson = await createPerson(
      db,
      {
        recordedSex: 'UNKNOWN',
        livingStatus: 'UNKNOWN',
        names: [{ type: 'BIRTH', given: 'Etranger', isPreferred: true, confidence: 'LOW' }],
      },
      { treeId: other.id, actorId: null },
    );
    const otherEvent = await createEvent(
      db,
      { type: 'CENSUS', participants: [{ personId: otherPerson.personId, role: 'PRINCIPAL' }] },
      { treeId: other.id, actorId: null },
    );

    await expect(
      createCitation(db, { sourceId: created.sourceId, eventId: otherEvent.eventId }, ctx),
    ).rejects.toThrow();

    await db.tree.delete({ where: { id: other.id } });
  });

  it('leaves a trace when it is removed', async () => {
    const created = await source('Source ephemere');
    const citation = await createCitation(
      db,
      { sourceId: created.sourceId, locator: 'vue 3', eventId },
      ctx,
    );
    await deleteCitation(db, citation.citationId, ctx);

    expect(await db.citation.findUnique({ where: { id: citation.citationId } })).toBeNull();
    const revision = await db.revision.findFirstOrThrow({
      where: { treeId, entityId: citation.citationId, action: 'DELETE' },
      select: { before: true },
    });
    // The pointer goes; the record that it existed does not.
    expect(revision.before).toMatchObject({ locator: 'vue 3' });
  });
});

describe('documents', () => {
  it('is found again by content, not by filename', async () => {
    const digest = 'a'.repeat(64);
    const created = await registerDocument(
      db,
      {
        title: 'Acte de naissance 1822',
        kind: 'BIRTH_ACT',
        originalFilename: 'scan (1).jpg',
        mimeType: 'image/jpeg',
        byteSize: 1234,
        checksum: digest,
        storageKey: `trees/${treeId}/document/${Date.now()}.jpg`,
      },
      ctx,
    );

    // The same act downloaded twice from an archive portal is one document.
    // Two rows would split the citations that point at it.
    const found = await findDocumentByChecksum(db, treeId, digest);
    expect(found?.id).toBe(created.documentId);
  });

  it('does not see a document from another tree', async () => {
    const digest = 'b'.repeat(64);
    const other = await db.tree.create({
      data: {
        name: 'Ailleurs3',
        slug: `oth3-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    await registerDocument(
      db,
      {
        title: 'Ailleurs',
        originalFilename: 'x.jpg',
        mimeType: 'image/jpeg',
        byteSize: 10,
        checksum: digest,
        storageKey: `trees/${other.id}/document/${Date.now()}-b.jpg`,
      },
      { treeId: other.id, actorId: null },
    );

    expect(await findDocumentByChecksum(db, treeId, digest)).toBeNull();
    await db.tree.delete({ where: { id: other.id } });
  });

  it('can be cited like any other evidence', async () => {
    const created = await source('Registre numerise');
    const document = await registerDocument(
      db,
      {
        title: 'Vue 118',
        originalFilename: 'vue118.jpg',
        mimeType: 'image/jpeg',
        byteSize: 5000,
        checksum: 'c'.repeat(64),
        storageKey: `trees/${treeId}/document/${Date.now()}-c.jpg`,
        sourceId: created.sourceId,
      },
      ctx,
    );

    const citation = await createCitation(
      db,
      { sourceId: created.sourceId, documentId: document.documentId, locator: 'vue 118', eventId },
      ctx,
    );

    const row = await db.citation.findUniqueOrThrow({
      where: { id: citation.citationId },
      select: { documentId: true, eventId: true },
    });
    expect(row.documentId).toBe(document.documentId);
    expect(row.eventId).toBe(eventId);
  });
});
