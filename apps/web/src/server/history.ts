import 'server-only';
import { cache } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { loadHistory, type HistoryEntry } from '@chronolignee/db';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ids';
import { describeRevision, type Change } from '@/lib/history-sentences';
import {
  isHiddenFrom,
  privacySubjectFromColumns,
  resolveTreeAccess,
  type TreeAccess,
} from './access';

/**
 * Who changed what, for the tree's members.
 *
 * Members only: the history names researchers and shows values as they were,
 * and neither belongs on a public page. Among members, an entry about someone
 * this reader may not see is left out entirely — "Noah a corrigé la fiche de
 * …" is the record the restriction exists to hide.
 */

export interface HistoryLine {
  readonly id: string;
  readonly at: string;
  readonly author: string;
  readonly sentence: string;
  readonly changes: readonly Change[];
  /** The person whose record this is, when the line is about one visible person. */
  readonly personId: string | null;
}

export interface TreeHistory {
  readonly access: TreeAccess;
  readonly lines: readonly HistoryLine[];
  readonly nextCursor: string | null;
}

export const loadTreeHistory = cache(
  async (treeSlug: string, cursor: string | null): Promise<TreeHistory | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access || access.role === null) return null;
    const page = await loadHistory(db, {
      treeId: access.treeId,
      ...(isUuid(cursor) ? { cursor } : {}),
      limit: 50,
    });
    return { access, lines: await readable(access, page.entries), nextCursor: page.nextCursor };
  },
);

/** One person's recent history, for their record page. */
export async function loadPersonHistory(
  access: TreeAccess,
  personId: string,
): Promise<readonly HistoryLine[]> {
  if (access.role === null) return [];
  const page = await loadHistory(db, { treeId: access.treeId, personId, limit: 20 });
  return readable(access, page.entries);
}

async function readable(
  access: TreeAccess,
  entries: readonly HistoryEntry[],
): Promise<HistoryLine[]> {
  const ids = [...new Set(entries.flatMap((entry) => entry.personIds))];
  // Removed people included: their history is still about them.
  const people = ids.length
    ? await db.person.findMany({
        where: { id: { in: ids }, treeId: access.treeId },
        select: {
          id: true,
          livingStatus: true,
          privacy: true,
          lifespanEarliestJdn: true,
          lifespanLatestJdn: true,
          lifespanLatestInferred: true,
        },
      })
    : [];
  const hidden = new Set(
    people
      .filter((person) => isHiddenFrom(privacySubjectFromColumns(person), access))
      .map((person) => person.id),
  );

  // One translator for the whole page: every line borrows the names of
  // events, relationships and roles from the namespaces that hold them.
  const t = await getTranslations();
  const locale = await getLocale();

  return entries
    .filter((entry) => !entry.personIds.some((id) => hidden.has(id)))
    .map((entry) => {
      const described = describeRevision(entry, t, locale);
      return {
        id: entry.revisionId,
        at: entry.createdAt.toISOString(),
        // A member whose account was erased signs nothing any more.
        author:
          entry.actorName ??
          (entry.entityType === 'TreeMember'
            ? t('history.formerMember')
            : t('history.unknownAuthor')),
        sentence: described.sentence,
        changes: described.changes,
        personId:
          entry.entityType === 'Person' && entry.action !== 'DELETE' ? entry.entityId : null,
      };
    });
}
