import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  MediaNotFound,
  createDatabase,
  createPerson,
  registerDocument,
  registerMedia,
  tagPersonInMedia,
  untagPersonInMedia,
  updateDocumentTranscription,
  updateMediaDetails,
  type Database,
} from '../src/index';

/**
 * Photographs, the people named in them, and transcriptions.
 *
 * What a write must do beyond inserting a row: keep a rectangle inside the
 * image, refuse a person from another family, move a rectangle rather than
 * list someone twice, read "when it was taken" as a genealogical date, and
 * leave the history a trace that does not copy a private text into it.
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
  treeId = (await db.tree.create({ data: { name: 'Album', slug: `album-${suffix}` } })).id;
  otherTreeId = (await db.tree.create({ data: { name: 'Autre', slug: `album-other-${suffix}` } }))
    .id;
  ctx = { treeId, actorId: null };
}, 60_000);

afterAll(async () => {
  for (const id of [treeId, otherTreeId]) {
    if (id) await db.tree.delete({ where: { id } }).catch(() => undefined);
  }
  await db.$disconnect();
});

const person = (given: string, tree = treeId) =>
  createPerson(
    db,
    {
      recordedSex: 'FEMALE',
      livingStatus: 'DECEASED',
      names: [
        { type: 'BIRTH', given, surname: 'VASSEUR', isPreferred: true, confidence: 'MEDIUM' },
      ],
    },
    { treeId: tree, actorId: null },
  );

let counter = 0;
const photo = () =>
  registerMedia(
    db,
    {
      originalFilename: `photo-${(counter += 1)}.jpg`,
      mimeType: 'image/jpeg',
      byteSize: 1000,
      checksum: `sum-${Date.now()}-${counter}`,
      storageKey: `media/${treeId}/key-${Date.now()}-${counter}.jpg`,
    },
    ctx,
  );

describe('naming someone in a photograph', () => {
  it('keeps the rectangle, and moves it when the same person is drawn again', async () => {
    const { mediaId } = await photo();
    const jeanne = await person('Jeanne');
    const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    await tagPersonInMedia(db, mediaId, { personId: jeanne.personId, region }, ctx);
    await tagPersonInMedia(
      db,
      mediaId,
      { personId: jeanne.personId, region: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } },
      ctx,
    );
    const tags = await db.personMediaTag.findMany({ where: { mediaId } });
    expect(tags).toHaveLength(1);
    expect(tags[0]?.x).toBe(0.5);

    const revisions = await db.revision.count({
      where: { treeId, entityType: 'PersonMediaTag', action: 'CREATE' },
    });
    expect(revisions).toBeGreaterThanOrEqual(2);
  });

  it('refuses a rectangle that leaves the image', async () => {
    const { mediaId } = await photo();
    const anne = await person('Anne');
    await expect(
      tagPersonInMedia(
        db,
        mediaId,
        { personId: anne.personId, region: { x: 0.8, y: 0.1, width: 0.5, height: 0.2 } },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses a person from another family', async () => {
    const { mediaId } = await photo();
    const stranger = await person('Étrangère', otherTreeId);
    await expect(
      tagPersonInMedia(db, mediaId, { personId: stranger.personId }, ctx),
    ).rejects.toBeInstanceOf(MediaNotFound);
  });

  it('removes a name, and only within the tree', async () => {
    const { mediaId } = await photo();
    const marie = await person('Marie');
    await tagPersonInMedia(db, mediaId, { personId: marie.personId }, ctx);
    await expect(
      untagPersonInMedia(db, mediaId, marie.personId, { treeId: otherTreeId, actorId: null }),
    ).rejects.toBeInstanceOf(MediaNotFound);
    await untagPersonInMedia(db, mediaId, marie.personId, ctx);
    expect(await db.personMediaTag.count({ where: { mediaId } })).toBe(0);
  });
});

describe('describing a photograph and a document', () => {
  it('reads when a photograph was taken as a genealogical date', async () => {
    const { mediaId } = await photo();
    await updateMediaDetails(db, mediaId, { title: 'La noce', captured: 'ABT 1912' }, ctx);
    const media = await db.media.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.title).toBe('La noce');
    expect(media.capturedOriginalText).toBe('ABT 1912');
    expect(media.capturedEarliestJdn).not.toBeNull();
    expect(media.capturedLatestJdn).toBeGreaterThan(media.capturedEarliestJdn ?? 0);
  });

  it('keeps a transcription verbatim, and the history only its length', async () => {
    const { documentId } = await registerDocument(
      db,
      {
        title: 'Acte',
        originalFilename: 'acte.png',
        mimeType: 'image/png',
        byteSize: 10,
        checksum: `doc-${Date.now()}`,
        storageKey: `documents/${treeId}/doc-${Date.now()}.png`,
      },
      ctx,
    );
    const text = 'led. Jean, fils de Pierre et de Marie, né le six juin';
    await updateDocumentTranscription(db, documentId, { transcription: text }, ctx);
    const document = await db.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.transcription).toBe(text);

    const revision = await db.revision.findFirstOrThrow({
      where: { treeId, entityType: 'Document', entityId: documentId, action: 'UPDATE' },
    });
    expect(JSON.stringify(revision.after)).not.toContain('Pierre');
    expect(revision.after).toMatchObject({ transcriptionLength: text.length });
  });
});
