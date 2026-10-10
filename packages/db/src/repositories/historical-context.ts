import type { Database } from '../client';

/**
 * What was happening in the world while a tree's family lived.
 *
 * Every tree gets its context without anyone curating it: the shared
 * catalogue's events that overlap the tree's span, in the countries where its
 * places are — plus world events, plus anything a member pinned to the tree
 * by hand. A tree with no located place yet is read as French, the product's
 * first audience, rather than shown no history at all.
 *
 * One query for the countries, one for the events, whatever the size of the
 * tree.
 */

export interface HistoricalContextEvent {
  readonly id: string;
  readonly title: string;
  readonly summary: string | null;
  readonly category: string;
  readonly significance: number;
  readonly startJdn: number;
  readonly endJdn: number;
  readonly countryCodes: readonly string[];
  readonly regionLabels: readonly string[];
  readonly pinned: boolean;
}

export async function loadHistoricalContext(
  db: Database,
  treeId: string,
  span: { readonly fromJdn: number; readonly toJdn: number },
): Promise<HistoricalContextEvent[]> {
  const places = await db.place.findMany({
    where: { treeId, countryCode: { not: null } },
    select: { countryCode: true },
    distinct: ['countryCode'],
  });
  const countries = places
    .map((place) => place.countryCode?.trim().toUpperCase())
    .filter((code): code is string => !!code);
  const scope = countries.length > 0 ? countries : ['FR'];

  const rows = await db.historicalEvent.findMany({
    where: {
      OR: [
        // Pinned by a member: shown whatever its dates or country.
        { trees: { some: { treeId, pinned: true } } },
        {
          startJdn: { lte: span.toJdn },
          endJdn: { gte: span.fromJdn },
          OR: [{ countryCodes: { isEmpty: true } }, { countryCodes: { hasSome: scope } }],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      summary: true,
      category: true,
      significance: true,
      startJdn: true,
      endJdn: true,
      countryCodes: true,
      regionLabels: true,
      trees: { where: { treeId }, select: { pinned: true } },
    },
    orderBy: [{ startJdn: 'asc' }, { significance: 'desc' }],
  });

  return rows.map(({ trees, ...event }) => ({
    ...event,
    pinned: trees.some((link) => link.pinned),
  }));
}
