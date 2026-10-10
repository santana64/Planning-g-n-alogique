import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { getServerEnv } from '@chronolignee/config/server';
import {
  createDatabase,
  linkMediaToEvent,
  recordMediaDerivatives,
  registerMedia,
  tagPersonInMedia,
  updateMediaDetails,
  type Database,
} from '@chronolignee/db';
import {
  buildObjectKey,
  checksum,
  objectStoreFromEnv,
  type ObjectStoreLike,
} from '@chronolignee/storage';
import { runMediaDerivatives } from '../media-derivatives';
import { demoIllustrations, type Illustration } from './illustrations';

/**
 * Puts the illustrations into the demonstration tree.
 *
 * Run after the database seed (`pnpm db:seed` does both). Goes through the
 * same steps as an upload — original stored under a random key, derivatives
 * made by the worker's own code, metadata-free — so the demo exercises the
 * real pipeline rather than a shortcut around it.
 *
 * Idempotent by title: a second run finishes what a first one left undone
 * and adds nothing twice. Only the deceased are identified in an
 * illustration; a living person found under one of the names is left out
 * and said so, never tagged.
 */

const DEMO_SLUG = 'famille-chassagne-demo';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

async function personByName(db: Database, treeId: string, name: string) {
  return db.person.findFirst({
    where: { treeId, displayName: name, deletedAt: null },
    select: { id: true, livingStatus: true },
  });
}

async function placeIllustration(
  db: Database,
  store: ObjectStoreLike,
  treeId: string,
  illustration: Illustration,
): Promise<{ created: boolean; tagged: number; linked: number; skipped: string[] }> {
  const ctx = { treeId, actorId: null };
  const skipped: string[] = [];
  let media = await db.media.findFirst({
    where: { treeId, title: illustration.title, deletedAt: null },
    select: { id: true, storageKey: true, thumbnailStorageKey: true },
  });
  const created = media === null;

  if (!media) {
    const png = await sharp(Buffer.from(illustration.svg)).png({ compressionLevel: 9 }).toBuffer();
    const bytes = new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
    const storageKey = buildObjectKey(treeId, 'media', 'png');
    await store.put(storageKey, bytes, { contentType: 'image/png' });
    const { mediaId } = await registerMedia(
      db,
      {
        originalFilename: `${illustration.key}.png`,
        mimeType: 'image/png',
        byteSize: bytes.byteLength,
        checksum: checksum(bytes),
        storageKey,
        title: illustration.title,
      },
      ctx,
    );
    await updateMediaDetails(
      db,
      mediaId,
      {
        title: illustration.title,
        description: illustration.description,
        captured: illustration.captured,
        copyright: 'Illustration de démonstration, Chronolignée',
      },
      ctx,
    );
    media = { id: mediaId, storageKey, thumbnailStorageKey: null };
  }

  if (!media.thumbnailStorageKey) {
    await runMediaDerivatives(
      {
        read: (key) => store.get(key),
        write: (key, bytes, contentType) => store.put(key, bytes, { contentType }),
        record: (mediaId, derivatives) => recordMediaDerivatives(db, mediaId, derivatives),
      },
      { treeId, mediaId: media.id, storageKey: media.storageKey },
    );
  }

  let tagged = 0;
  for (const figure of illustration.figures) {
    const person = await personByName(db, treeId, figure.name);
    if (!person) {
      skipped.push(`${figure.name}: absent`);
      continue;
    }
    if (person.livingStatus !== 'DECEASED') {
      skipped.push(`${figure.name}: not recorded as deceased`);
      continue;
    }
    const existing = await db.personMediaTag.findUnique({
      where: { mediaId_personId: { mediaId: media.id, personId: person.id } },
      select: { id: true },
    });
    if (existing) continue;
    await tagPersonInMedia(db, media.id, { personId: person.id, region: figure.region }, ctx);
    tagged += 1;
  }

  let linked = 0;
  for (const wanted of illustration.events) {
    const event = await db.event.findFirst({
      where: {
        treeId,
        deletedAt: null,
        type: wanted.type,
        dateOriginalText: wanted.date,
        AND: wanted.people.map((name) => ({
          participants: { some: { person: { displayName: name } } },
        })),
      },
      select: { id: true },
    });
    if (!event) {
      skipped.push(`${wanted.type} ${wanted.date}: no such event`);
      continue;
    }
    const already = await db.eventMedia.findUnique({
      where: { eventId_mediaId: { eventId: event.id, mediaId: media.id } },
      select: { eventId: true },
    });
    if (already) continue;
    await linkMediaToEvent(db, media.id, event.id, ctx);
    linked += 1;
  }
  return { created, tagged, linked, skipped };
}

async function main() {
  const env = getServerEnv();
  const db = createDatabase({ url: env.DATABASE_URL });
  const store = objectStoreFromEnv(env);
  try {
    const tree = await db.tree.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true } });
    if (!tree) {
      log('demo photos: no demonstration tree — run the database seed first');
      return;
    }
    for (const illustration of demoIllustrations()) {
      const result = await placeIllustration(db, store, tree.id, illustration);
      log(
        `demo photos: ${illustration.key} — ${result.created ? 'added' : 'present'}, ` +
          `${result.tagged} tagged, ${result.linked} linked` +
          (result.skipped.length ? ` (skipped: ${result.skipped.join('; ')})` : ''),
      );
    }
  } finally {
    await db.$disconnect();
  }
}

await main();
