import { z } from 'zod';
import type { Database } from '../client';
import { recordRevision } from './audit';
import type { PersonWriteContext } from './person';

/**
 * Sources, citations, and what they are attached to.
 *
 * The distinction the whole model turns on, and the one most genealogy
 * software collapses:
 *
 *   Source   — the thing that exists in the world. A parish register, a
 *              census, a letter in a shoebox.
 *   Citation — where inside it. Page 42, act 7, view 118. This is what
 *              another researcher needs in order to check your work.
 *   Claim    — what you read there, and whether a human accepted it.
 *
 * Collapsing citation into source gives "Archives d'Indre-et-Loire" as the
 * evidence for a birth date, which is not evidence, it is a building.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .optional();

/** Mirrors the SourceType enum in the schema. Kept in the same order. */
export const SOURCE_TYPES = [
  'CIVIL_REGISTER',
  'PARISH_REGISTER',
  'CENSUS',
  'MILITARY_RECORD',
  'NOTARIAL_ACT',
  'NEWSPAPER',
  'CEMETERY',
  'BOOK',
  'WEBSITE',
  'DATABASE',
  'PHOTOGRAPH',
  'LETTER',
  'ORAL_HISTORY',
  'DNA',
  'OTHER',
] as const;

/** Mirrors the DocumentKind enum in the schema. */
export const DOCUMENT_KINDS = [
  'BIRTH_ACT',
  'MARRIAGE_ACT',
  'DEATH_ACT',
  'BAPTISM_ACT',
  'BURIAL_ACT',
  'CENSUS_PAGE',
  'MILITARY_RECORD',
  'NOTARIAL_ACT',
  'LETTER',
  'CERTIFICATE',
  'NEWSPAPER_CLIPPING',
  'OTHER',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const CONFIDENCE_LEVELS = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const;

export const createSourceInput = z.object({
  title: z.string().trim().min(1).max(300),
  type: z.enum(SOURCE_TYPES).default('OTHER'),
  author: optionalText(200),
  repository: optionalText(200),
  /**
   * The archival call number — "cote" in French archives.
   *
   * The single most useful field on this record. A title tells a reader what
   * the document is; the call number is what lets them walk into the reading
   * room and ask for it.
   */
  callNumber: optionalText(120),
  url: optionalText(2000),
  publishedAt: optionalText(80),
  reliability: z.enum(CONFIDENCE_LEVELS).default('MEDIUM'),
  notes: optionalText(4000),
});
export type CreateSourceInput = z.input<typeof createSourceInput>;

export const createCitationInput = z.object({
  sourceId: z.uuid(),
  /** Page, folio, view, act number — wherever inside the source this is. */
  locator: optionalText(200),
  page: optionalText(40),
  volume: optionalText(40),
  /** Verbatim transcription of the passage, never a paraphrase. */
  quotation: optionalText(4000),
  confidence: z.enum(CONFIDENCE_LEVELS).default('MEDIUM'),
  notes: optionalText(2000),
  /** What this citation supports. At most one is set. */
  eventId: z.uuid().optional(),
  documentId: z.uuid().optional(),
});
export type CreateCitationInput = z.input<typeof createCitationInput>;

export interface SourceWriteResult {
  readonly sourceId: string;
}

export async function createSource(
  db: Database,
  raw: CreateSourceInput,
  context: PersonWriteContext,
): Promise<SourceWriteResult> {
  const input = createSourceInput.parse(raw);

  return db.$transaction(async (tx) => {
    const source = await tx.source.create({
      data: {
        treeId: context.treeId,
        title: input.title,
        type: input.type,
        ...(input.author ? { author: input.author } : {}),
        ...(input.repository ? { repository: input.repository } : {}),
        ...(input.callNumber ? { callNumber: input.callNumber } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        reliability: input.reliability,
        ...(context.actorId ? { createdById: context.actorId } : {}),
      },
    });

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Source',
      entityId: source.id,
      action: 'CREATE',
      actorId: context.actorId,
      after: { title: input.title, type: input.type, callNumber: input.callNumber ?? null },
      summary: `Source « ${input.title} » ajoutée`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    return { sourceId: source.id };
  });
}

export interface CitationWriteResult {
  readonly citationId: string;
}

export async function createCitation(
  db: Database,
  raw: CreateCitationInput,
  context: PersonWriteContext,
): Promise<CitationWriteResult> {
  const input = createCitationInput.parse(raw);

  return db.$transaction(async (tx) => {
    // The source must belong to this tree. Without the check, a citation
    // could point at another family's archive and quietly join two trees.
    const source = await tx.source.findFirstOrThrow({
      where: { id: input.sourceId, treeId: context.treeId, deletedAt: null },
      select: { id: true, title: true },
    });

    if (input.eventId) {
      await tx.event.findFirstOrThrow({
        where: { id: input.eventId, treeId: context.treeId, deletedAt: null },
        select: { id: true },
      });
    }
    if (input.documentId) {
      await tx.document.findFirstOrThrow({
        where: { id: input.documentId, treeId: context.treeId, deletedAt: null },
        select: { id: true },
      });
    }

    const citation = await tx.citation.create({
      data: {
        treeId: context.treeId,
        sourceId: source.id,
        ...(input.locator ? { locator: input.locator } : {}),
        ...(input.page ? { page: input.page } : {}),
        ...(input.volume ? { volume: input.volume } : {}),
        ...(input.quotation ? { quotation: input.quotation } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.eventId ? { eventId: input.eventId } : {}),
        ...(input.documentId ? { documentId: input.documentId } : {}),
        confidence: input.confidence,
        ...(context.actorId ? { createdById: context.actorId } : {}),
      },
    });

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Citation',
      entityId: citation.id,
      action: 'CREATE',
      actorId: context.actorId,
      after: { source: source.title, locator: input.locator ?? null },
      summary: `${source.title}${input.locator ? ` — ${input.locator}` : ''}`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });

    return { citationId: citation.id };
  });
}

export async function deleteCitation(
  db: Database,
  citationId: string,
  context: PersonWriteContext,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const citation = await tx.citation.findFirstOrThrow({
      where: { id: citationId, treeId: context.treeId },
      select: { id: true, locator: true, source: { select: { title: true } } },
    });

    // A citation carries no history of its own — it is a pointer, and the
    // revision below is where the removal is recorded. Deleting it outright
    // keeps the evidence list honest rather than full of tombstones.
    await tx.citation.delete({ where: { id: citation.id } });

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Citation',
      entityId: citation.id,
      action: 'DELETE',
      actorId: context.actorId,
      before: { source: citation.source.title, locator: citation.locator },
      summary: `Citation retirée : ${citation.source.title}`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });
  });
}

export interface RegisterDocumentInput {
  readonly title: string;
  readonly kind?: DocumentKind | undefined;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly storageKey: string;
  readonly sourceId?: string | undefined;
}

/**
 * Record a document that has already been stored.
 *
 * Split from the upload deliberately: the bytes go to object storage through
 * a route that validates them, and this only writes the row. A single
 * function doing both would make the database depend on S3 being reachable
 * inside a transaction.
 */
export async function registerDocument(
  db: Database,
  input: RegisterDocumentInput,
  context: PersonWriteContext,
): Promise<{ documentId: string }> {
  return db.$transaction(async (tx) => {
    if (input.sourceId) {
      await tx.source.findFirstOrThrow({
        where: { id: input.sourceId, treeId: context.treeId, deletedAt: null },
        select: { id: true },
      });
    }

    const document = await tx.document.create({
      data: {
        treeId: context.treeId,
        title: input.title,
        kind: input.kind ?? 'OTHER',
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        checksum: input.checksum,
        storageKey: input.storageKey,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        ...(context.actorId ? { createdById: context.actorId } : {}),
      },
    });

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Document',
      entityId: document.id,
      action: 'CREATE',
      actorId: context.actorId,
      after: { title: input.title, filename: input.originalFilename, bytes: input.byteSize },
      summary: `Document « ${input.title} » versé`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });

    return { documentId: document.id };
  });
}

/**
 * A document already held, by checksum.
 *
 * The same act photographed twice, or downloaded twice from the same archive
 * portal, is one document. Storing it again wastes space and — worse — splits
 * the citations that point at it across two rows.
 */
export async function findDocumentByChecksum(
  db: Database,
  treeId: string,
  checksum: string,
): Promise<{ id: string; title: string } | null> {
  return db.document.findFirst({
    where: { treeId, checksum, deletedAt: null },
    select: { id: true, title: true },
  });
}
