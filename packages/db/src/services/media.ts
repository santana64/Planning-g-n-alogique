import { parseGenealogicalDate } from '@chronolignee/domain';
import { z } from 'zod';
import type { Database } from '../client';
import { recordRevision } from './audit';
import type { PersonWriteContext } from './person';

/**
 * Photographs, and the people a human has recognised in them.
 *
 * Recognition is manual, always: a person draws a rectangle and says who it
 * is. No face is detected, measured or compared — a biometric template of a
 * living relative is not something a family archive should manufacture, and
 * a machine's guess at who is in a photograph is exactly the kind of
 * plausible, unsourced claim this product exists to keep out of a tree.
 *
 * Regions are fractions of the image (0–1), so they survive the image being
 * shown at another size, and a tag is attributed to whoever drew it.
 */

export class MediaNotFound extends Error {
  constructor() {
    super('media not found in this tree');
  }
}

export interface RegisterMediaInput {
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly storageKey: string;
  readonly title?: string | null;
}

export async function registerMedia(
  db: Database,
  input: RegisterMediaInput,
  context: PersonWriteContext,
): Promise<{ mediaId: string }> {
  return db.$transaction(async (tx) => {
    const media = await tx.media.create({
      data: {
        treeId: context.treeId,
        kind: 'IMAGE',
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        checksum: input.checksum,
        storageKey: input.storageKey,
        title: input.title ?? null,
        createdById: context.actorId,
      },
      select: { id: true },
    });
    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Media',
      entityId: media.id,
      action: 'CREATE',
      actorId: context.actorId,
      after: { title: input.title ?? input.originalFilename },
      batchId: context.batchId,
    });
    return { mediaId: media.id };
  });
}

export async function findMediaByChecksum(
  db: Database,
  treeId: string,
  checksum: string,
): Promise<{ id: string } | null> {
  return db.media.findFirst({ where: { treeId, checksum, deletedAt: null }, select: { id: true } });
}

/** Written by the worker once the thumbnail and preview exist. */
export async function recordMediaDerivatives(
  db: Database,
  mediaId: string,
  derivatives: {
    readonly thumbnailStorageKey: string;
    readonly previewStorageKey: string;
    readonly width: number;
    readonly height: number;
  },
): Promise<void> {
  await db.media.update({ where: { id: mediaId }, data: derivatives });
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .optional();

export const updateMediaInput = z.object({
  title: optionalText(200),
  description: optionalText(4000),
  captured: optionalText(80),
  copyright: optionalText(200),
});

/** Title, caption, when it was taken (as genealogists write dates), credit. */
export async function updateMediaDetails(
  db: Database,
  mediaId: string,
  raw: unknown,
  context: PersonWriteContext,
): Promise<void> {
  const input = updateMediaInput.parse(raw);
  const captured = input.captured ? parseGenealogicalDate(input.captured) : null;

  await db.$transaction(async (tx) => {
    const before = await tx.media.findFirst({
      where: { id: mediaId, treeId: context.treeId, deletedAt: null },
      select: { title: true, description: true, capturedOriginalText: true, copyright: true },
    });
    if (!before) throw new MediaNotFound();

    const after = {
      title: input.title ?? null,
      description: input.description ?? null,
      capturedOriginalText: input.captured ?? null,
      copyright: input.copyright ?? null,
    };
    await tx.media.update({
      where: { id: mediaId },
      data: {
        ...after,
        capturedEarliestJdn: captured?.interval.earliest ?? null,
        capturedLatestJdn: captured?.interval.latest ?? null,
      },
    });
    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Media',
      entityId: mediaId,
      action: 'UPDATE',
      actorId: context.actorId,
      before,
      after,
      batchId: context.batchId,
    });
  });
}

// --- Tags -------------------------------------------------------------------

export const regionInput = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine((r) => r.x + r.width <= 1.0001 && r.y + r.height <= 1.0001, 'REGION_OUTSIDE_IMAGE');

export const tagPersonInput = z.object({
  personId: z.uuid(),
  region: regionInput.nullable().optional(),
  note: optionalText(300),
});

/**
 * Say who is in a photograph, and where.
 *
 * One tag per person per photograph: drawing someone a second time moves
 * their rectangle rather than listing them twice.
 */
export async function tagPersonInMedia(
  db: Database,
  mediaId: string,
  raw: unknown,
  context: PersonWriteContext,
): Promise<{ tagId: string }> {
  const input = tagPersonInput.parse(raw);
  const region = input.region ?? null;

  return db.$transaction(async (tx) => {
    const [media, person] = await Promise.all([
      tx.media.findFirst({
        where: { id: mediaId, treeId: context.treeId, deletedAt: null },
        select: { id: true },
      }),
      tx.person.findFirst({
        where: { id: input.personId, treeId: context.treeId, deletedAt: null },
        select: { id: true, displayName: true },
      }),
    ]);
    if (!media || !person) throw new MediaNotFound();

    const tag = await tx.personMediaTag.upsert({
      where: { mediaId_personId: { mediaId, personId: input.personId } },
      create: {
        mediaId,
        personId: input.personId,
        ...(region ?? {}),
        note: input.note ?? null,
        createdById: context.actorId,
      },
      update: {
        x: region?.x ?? null,
        y: region?.y ?? null,
        width: region?.width ?? null,
        height: region?.height ?? null,
        note: input.note ?? null,
      },
      select: { id: true },
    });
    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'PersonMediaTag',
      entityId: tag.id,
      action: 'CREATE',
      actorId: context.actorId,
      after: { mediaId, personId: input.personId, name: person.displayName },
      batchId: context.batchId,
    });
    return { tagId: tag.id };
  });
}

export async function untagPersonInMedia(
  db: Database,
  mediaId: string,
  personId: string,
  context: PersonWriteContext,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const tag = await tx.personMediaTag.findFirst({
      where: { mediaId, personId, media: { treeId: context.treeId } },
      select: { id: true, person: { select: { displayName: true } } },
    });
    if (!tag) throw new MediaNotFound();
    await tx.personMediaTag.delete({ where: { id: tag.id } });
    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'PersonMediaTag',
      entityId: tag.id,
      action: 'DELETE',
      actorId: context.actorId,
      before: { mediaId, personId, name: tag.person.displayName },
      batchId: context.batchId,
    });
  });
}

// --- Document transcription -------------------------------------------------

export const transcriptionInput = z.object({
  transcription: z.string().max(200_000),
});

/**
 * The transcription a human typed while reading the document.
 *
 * Kept verbatim — abbreviations, spellings, "led. Jean" — because a
 * normalised transcription is an interpretation, and the act is the source.
 */
export async function updateDocumentTranscription(
  db: Database,
  documentId: string,
  raw: unknown,
  context: PersonWriteContext,
): Promise<void> {
  const { transcription } = transcriptionInput.parse(raw);
  const value = transcription.trim().length === 0 ? null : transcription;

  await db.$transaction(async (tx) => {
    const before = await tx.document.findFirst({
      where: { id: documentId, treeId: context.treeId, deletedAt: null },
      select: { title: true, transcription: true },
    });
    if (!before) throw new MediaNotFound();
    if (before.transcription === value) return;
    await tx.document.update({ where: { id: documentId }, data: { transcription: value } });
    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Document',
      entityId: documentId,
      action: 'UPDATE',
      actorId: context.actorId,
      // The text itself can be long and private; the history says that it
      // changed and how much, not what it says.
      before: { title: before.title, transcriptionLength: before.transcription?.length ?? 0 },
      after: { title: before.title, transcriptionLength: value?.length ?? 0 },
      batchId: context.batchId,
    });
  });
}
