'use server';

import { searchPeople, searchPlaces } from '@chronolignee/db';
import { db } from '@/lib/db';
import { REDACTED_LABEL, isHiddenFrom, resolveTreeAccess } from './access';

/**
 * The command palette's search.
 *
 * Runs on the server for three reasons, only one of which is performance: the
 * trigram index lives there, the fold that matches the stored name lives
 * there, and redaction lives there. A client-side filter over a downloaded
 * list would quietly ship every living person's name to anyone who opened the
 * page.
 */

export interface SearchResultItem {
  readonly kind: 'PERSON' | 'PLACE';
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  /** True when the match was not literal. Shown, never hidden. */
  readonly approximate: boolean;
  readonly redacted: boolean;
}

export async function searchTreeAction(
  treeSlug: string,
  query: string,
): Promise<readonly SearchResultItem[]> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return [];
  if (query.trim().length < 2) return [];

  const [people, places] = await Promise.all([
    searchPeople(db, { treeId: access.treeId, query, limit: 8 }),
    searchPlaces(db, { treeId: access.treeId, query, limit: 4 }),
  ]);

  const results: SearchResultItem[] = people.map((hit) => {
    const isLiving = hit.livingStatus === 'LIVING';
    const hidden = isHiddenFrom({ isLiving }, access.redactLiving);
    return {
      kind: 'PERSON' as const,
      id: hit.personId,
      label: hidden ? REDACTED_LABEL : hit.displayName,
      // The years go with the name. A hidden name beside "1962 –" is not hidden.
      detail: hidden ? '' : lifespanLabel(hit.lifespanEarliestJdn, hit.lifespanLatestJdn, isLiving),
      approximate: hit.approximate,
      redacted: hidden,
    };
  });

  for (const place of places) {
    results.push({
      kind: 'PLACE',
      id: place.placeId,
      label: place.name,
      detail:
        place.personCount === 0
          ? 'aucune personne'
          : place.personCount === 1
            ? '1 personne'
            : `${place.personCount} personnes`,
      approximate: false,
      redacted: false,
    });
  }

  return results;
}

function lifespanLabel(earliest: number | null, latest: number | null, isLiving: boolean): string {
  const from = earliest === null ? '?' : String(jdnYear(earliest));
  if (isLiving) return `${from} –`;
  const to = latest === null ? '?' : String(jdnYear(latest));
  return `${from} – ${to}`;
}

function jdnYear(jdn: number): number {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return 100 * b + d - 4800 + Math.floor(m / 10);
}
