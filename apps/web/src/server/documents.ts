import 'server-only';
import { cache } from 'react';
import { getTranslations } from 'next-intl/server';
import { dateToJdn } from '@chronolignee/domain';
import { db } from '@/lib/db';
import { hiddenInGraph, resolveTreeAccess, type TreeAccess } from './access';
import { treeGraph } from './graph-cache';

/**
 * One document, as the viewer shows it: the file, what it is, its
 * transcription, and the facts in the tree that cite it.
 *
 * The same privacy ladder as the listing and the download route. A citation
 * is listed with the people it concerns that this reader may see; one that
 * concerns only hidden people is left out, since its event would date them.
 */

export interface DocumentCitation {
  readonly citationId: string;
  readonly locator: string | null;
  readonly quotation: string | null;
  /** "Naissance", when the citation supports an event. */
  readonly eventLabel: string | null;
  readonly people: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export interface DocumentView {
  readonly access: TreeAccess;
  readonly storageKey: string;
  readonly document: {
    readonly id: string;
    readonly title: string;
    readonly kind: string;
    readonly mimeType: string;
    readonly byteSize: number;
    readonly pageCount: number;
    readonly transcription: string | null;
    readonly notes: string | null;
    readonly sourceTitle: string | null;
    readonly callNumber: string | null;
    readonly repository: string | null;
  };
  readonly citations: readonly DocumentCitation[];
  readonly pendingProposals: number | null;
}

function allowed(access: TreeAccess, privacy: string): boolean {
  const isAdmin = access.role === 'OWNER' || access.role === 'ADMIN';
  if (privacy === 'RESTRICTED') return isAdmin;
  if (privacy === 'REDACTED') return access.role !== null;
  return true;
}

export const loadDocumentView = cache(
  async (treeSlug: string, documentId: string): Promise<DocumentView | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access) return null;

    const row = await db.document.findFirst({
      where: { id: documentId, treeId: access.treeId, deletedAt: null },
      select: {
        id: true,
        title: true,
        kind: true,
        mimeType: true,
        byteSize: true,
        pageCount: true,
        transcription: true,
        notes: true,
        privacy: true,
        storageKey: true,
        source: { select: { title: true, callNumber: true, repository: true } },
        citations: {
          select: {
            id: true,
            locator: true,
            page: true,
            quotation: true,
            event: {
              select: {
                type: true,
                customType: true,
                deletedAt: true,
                participants: { select: { personId: true } },
              },
            },
            claims: { select: { claim: { select: { personId: true } } } },
          },
        },
      },
    });
    if (!row || !allowed(access, row.privacy)) return null;

    const graph = await treeGraph(access.treeId, dateToJdn(new Date()));
    const hidden = hiddenInGraph(graph, access);
    const tEvents = await getTranslations('events');

    const citations: DocumentCitation[] = [];
    for (const citation of row.citations) {
      const ids = [
        ...(citation.event && !citation.event.deletedAt
          ? citation.event.participants.map((p) => p.personId)
          : []),
        ...citation.claims.map((link) => link.claim.personId).filter((id): id is string => !!id),
      ];
      const unique = [...new Set(ids)];
      const shown = unique.filter((id) => graph.people.has(id) && !hidden(id));
      if (unique.length > 0 && shown.length === 0) continue;
      const event = citation.event && !citation.event.deletedAt ? citation.event : null;
      citations.push({
        citationId: citation.id,
        locator: [citation.page, citation.locator].filter(Boolean).join(' · ') || null,
        quotation: citation.quotation,
        eventLabel: event
          ? event.type === 'CUSTOM' && event.customType
            ? event.customType
            : tEvents.has(event.type)
              ? tEvents(event.type)
              : event.type
          : null,
        people: shown.map((id) => ({ id, name: graph.people.get(id)?.displayName ?? '' })),
      });
    }

    const pendingProposals = access.canEdit
      ? await db.aiProposal.count({
          where: { treeId: access.treeId, documentId, status: 'PENDING' },
        })
      : null;

    return {
      access,
      storageKey: row.storageKey,
      document: {
        id: row.id,
        title: row.title,
        kind: row.kind,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        pageCount: row.pageCount,
        transcription: row.transcription,
        notes: row.notes,
        sourceTitle: row.source?.title ?? null,
        callNumber: row.source?.callNumber ?? null,
        repository: row.source?.repository ?? null,
      },
      citations,
      pendingProposals,
    };
  },
);
