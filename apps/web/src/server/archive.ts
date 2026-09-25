import 'server-only';
import { cache } from 'react';
import { db } from '@/lib/db';
import { resolveTreeAccess, type TreeAccess } from './access';

/**
 * The archive: what the research rests on.
 *
 * A source is the thing in the world, a citation is where inside it, and a
 * document is the image of it. The list is ordered by how much each source is
 * actually used, because a register cited forty times is the backbone of the
 * tree and a website cited once is a lead.
 */

export interface SourceRow {
  readonly sourceId: string;
  readonly title: string;
  readonly type: string;
  readonly author: string | null;
  readonly repository: string | null;
  readonly callNumber: string | null;
  readonly url: string | null;
  readonly reliability: string;
  readonly citationCount: number;
  readonly documentCount: number;
}

export interface ArchiveListing {
  readonly access: TreeAccess;
  readonly sources: readonly SourceRow[];
  readonly documentCount: number;
  /**
   * Events carrying no citation at all.
   *
   * The number that says what the tree is worth. A genealogy where nothing is
   * cited is a family story, which is a fine thing to have and not the same
   * thing as research — and software that never shows this number lets the
   * difference blur.
   */
  readonly uncitedEventCount: number;
  readonly citedEventCount: number;
}

export const loadArchive = cache(async (treeSlug: string): Promise<ArchiveListing | null> => {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return null;

  const sources = await db.source.findMany({
    where: { treeId: access.treeId, deletedAt: null },
    select: {
      id: true,
      title: true,
      type: true,
      author: true,
      repository: true,
      callNumber: true,
      url: true,
      reliability: true,
      _count: { select: { citations: true, documents: true } },
    },
    orderBy: [{ citations: { _count: 'desc' } }, { title: 'asc' }],
  });

  const [documentCount, citedEventCount, totalEvents] = await Promise.all([
    db.document.count({ where: { treeId: access.treeId, deletedAt: null } }),
    db.event.count({
      where: { treeId: access.treeId, deletedAt: null, citations: { some: {} } },
    }),
    db.event.count({ where: { treeId: access.treeId, deletedAt: null } }),
  ]);

  return {
    access,
    sources: sources.map((source) => ({
      sourceId: source.id,
      title: source.title,
      type: source.type,
      author: source.author,
      repository: source.repository,
      callNumber: source.callNumber,
      url: source.url,
      reliability: source.reliability,
      citationCount: source._count.citations,
      documentCount: source._count.documents,
    })),
    documentCount,
    citedEventCount,
    uncitedEventCount: totalEvents - citedEventCount,
  };
});

export interface DocumentRow {
  readonly documentId: string;
  readonly title: string;
  readonly kind: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sourceTitle: string | null;
  readonly citationCount: number;
  readonly isImage: boolean;
}

export const loadDocuments = cache(
  async (treeSlug: string): Promise<{ access: TreeAccess; documents: DocumentRow[] } | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access) return null;

    const rows = await db.document.findMany({
      where: {
        treeId: access.treeId,
        deletedAt: null,
        // REDACTED is withheld from anyone outside the tree; RESTRICTED goes
        // further and is for its administrators. Someone's grandmother's
        // letters can sit inside a published genealogy without themselves
        // being published.
        ...(access.role === null
          ? { privacy: { notIn: ['REDACTED', 'RESTRICTED'] as const } }
          : access.role === 'OWNER' || access.role === 'ADMIN'
            ? {}
            : { privacy: { not: 'RESTRICTED' as const } }),
      },
      select: {
        id: true,
        title: true,
        kind: true,
        mimeType: true,
        byteSize: true,
        source: { select: { title: true } },
        _count: { select: { citations: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      access,
      documents: rows.map((row) => ({
        documentId: row.id,
        title: row.title,
        kind: row.kind,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        sourceTitle: row.source?.title ?? null,
        citationCount: row._count.citations,
        isImage: row.mimeType.startsWith('image/'),
      })),
    };
  },
);

export interface EventCitation {
  readonly citationId: string;
  readonly sourceTitle: string;
  readonly sourceType: string;
  readonly callNumber: string | null;
  readonly locator: string | null;
  readonly page: string | null;
  readonly quotation: string | null;
  readonly confidence: string;
  readonly documentId: string | null;
}

/** Citations attached to a person's events, keyed by event. */
export async function loadCitationsForPerson(
  treeId: string,
  personId: string,
): Promise<Map<string, EventCitation[]>> {
  const rows = await db.citation.findMany({
    where: {
      treeId,
      event: { deletedAt: null, participants: { some: { personId } } },
    },
    select: {
      id: true,
      eventId: true,
      locator: true,
      page: true,
      quotation: true,
      confidence: true,
      documentId: true,
      source: { select: { title: true, type: true, callNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const byEvent = new Map<string, EventCitation[]>();
  for (const row of rows) {
    if (!row.eventId) continue;
    const list = byEvent.get(row.eventId) ?? [];
    list.push({
      citationId: row.id,
      sourceTitle: row.source.title,
      sourceType: row.source.type,
      callNumber: row.source.callNumber,
      locator: row.locator,
      page: row.page,
      quotation: row.quotation,
      confidence: row.confidence,
      documentId: row.documentId,
    });
    byEvent.set(row.eventId, list);
  }
  return byEvent;
}
