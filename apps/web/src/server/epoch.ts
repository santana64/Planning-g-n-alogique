import 'server-only';
import { dateToJdn } from '@chronolignee/domain';
import { loadHistoricalContext } from '@chronolignee/db';
import { db } from '@/lib/db';
import type { TreeAccess } from './access';

/**
 * What a person lived through: the tree's historical context, cut to their
 * life, with how old they were when each event began.
 *
 * An age is given only when the birth is known to within about a year;
 * otherwise the event is listed without one rather than with a guess. A
 * life with no recorded end stops at the maximum-lifespan bound the
 * projection already uses — never at today for someone long dead.
 */

export interface EpochEvent {
  readonly id: string;
  readonly title: string;
  readonly summary: string | null;
  readonly category: string;
  readonly significance: number;
  readonly startJdn: number;
  readonly endJdn: number;
  /** Age when the event began, or null when the birth is too vague, or when it began before. */
  readonly age: number | null;
  /** The event began before the birth and was still going on. */
  readonly bornDuring: boolean;
}

export async function loadEpoch(
  access: TreeAccess,
  personId: string,
): Promise<readonly EpochEvent[]> {
  const person = await db.person.findFirst({
    where: { id: personId, treeId: access.treeId, deletedAt: null },
    select: { lifespanEarliestJdn: true, lifespanLatestJdn: true, birthSortJdn: true },
  });
  if (!person || person.lifespanEarliestJdn === null) return [];
  const from = person.lifespanEarliestJdn;
  const to = person.lifespanLatestJdn ?? dateToJdn(new Date());

  const birthWindow = await db.event.findFirst({
    where: {
      treeId: access.treeId,
      deletedAt: null,
      type: { in: ['BIRTH', 'BAPTISM'] },
      participants: { some: { personId, role: 'PRINCIPAL' } },
    },
    select: { dateEarliestJdn: true, dateLatestJdn: true },
    orderBy: { type: 'asc' },
  });
  const precise =
    birthWindow?.dateEarliestJdn != null &&
    birthWindow.dateLatestJdn != null &&
    birthWindow.dateLatestJdn - birthWindow.dateEarliestJdn <= 400;
  const birth = precise
    ? Math.floor(((birthWindow?.dateEarliestJdn ?? 0) + (birthWindow?.dateLatestJdn ?? 0)) / 2)
    : null;

  const context = await loadHistoricalContext(db, access.treeId, { fromJdn: from, toJdn: to });
  return context
    .filter((event) => event.startJdn <= to && event.endJdn >= from)
    .map((event) => {
      const bornDuring = event.startJdn < from;
      return {
        id: event.id,
        title: event.title,
        summary: event.summary,
        category: event.category,
        significance: event.significance,
        startJdn: event.startJdn,
        endJdn: event.endJdn,
        age: birth !== null && !bornDuring ? Math.floor((event.startJdn - birth) / 365.2425) : null,
        bornDuring,
      };
    });
}
