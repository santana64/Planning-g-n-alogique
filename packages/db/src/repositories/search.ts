// Prisma 7 generates its client into the package rather than into
// node_modules, so the sql tag comes from the generated namespace and not
// from '@prisma/client'.
import { sql } from '../../generated/client/internal/prismaNamespace';
import { foldName } from '../normalise';
import type { Database } from '../client';

/**
 * Finding a person by name.
 *
 * `LIKE '%x%'` is not good enough for genealogy. The name a researcher types
 * is the name they read in a register, and the name in the database is the
 * name some other clerk wrote in some other register — CHASSAGNE and
 * CHASSAIGNE, LEFEVRE and LEFÈVRE, MOREAU and MORREAU. A search that only
 * finds exact substrings hides the duplicate the researcher is hunting for,
 * which is the single most common thing anyone does in this software.
 *
 * So: trigram similarity, with exact and prefix matches promoted above it.
 * The scoring is explicit rather than left to `%` and the session's
 * similarity threshold, because a GUC set somewhere else would silently
 * change what this returns.
 */

export interface SearchOptions {
  readonly treeId: string;
  readonly query: string;
  readonly limit?: number;
  /**
   * How close a trigram match has to be. Below roughly 0.25 the results stop
   * being names that look alike and start being names that share letters.
   */
  readonly threshold?: number;
}

export interface PersonSearchHit {
  readonly personId: string;
  readonly displayName: string;
  readonly searchName: string;
  readonly livingStatus: 'LIVING' | 'DECEASED' | 'UNKNOWN';
  readonly birthSortJdn: number | null;
  readonly lifespanEarliestJdn: number | null;
  readonly lifespanLatestJdn: number | null;
  /** 0 to 1. Exact and prefix matches are promoted above similarity. */
  readonly score: number;
  /** True when the match was not literal — worth saying so in the UI. */
  readonly approximate: boolean;
}

export const DEFAULT_SEARCH_LIMIT = 12;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.28;

interface RawHit {
  id: string;
  displayName: string;
  searchName: string;
  livingStatus: 'LIVING' | 'DECEASED' | 'UNKNOWN';
  birthSortJdn: number | null;
  lifespanEarliestJdn: number | null;
  lifespanLatestJdn: number | null;
  score: number;
}

/**
 * A four-digit run in the query, read as a year.
 *
 * "chassagne 1822" is how people actually search: a name and roughly when.
 * The year narrows rather than filters — a birth recorded as 1823 when the
 * researcher typed 1822 is exactly the record they are trying to reconcile,
 * so it is ranked lower, not removed.
 */
function splitYear(query: string): { text: string; year: number | null } {
  const match = /(?:^|\s)(1[0-9]{3}|20[0-9]{2})(?:\s|$)/.exec(query);
  if (!match || match[1] === undefined) return { text: query, year: null };
  return {
    text: (query.slice(0, match.index) + ' ' + query.slice(match.index + match[0].length)).trim(),
    year: Number.parseInt(match[1], 10),
  };
}

/** Julian day number of 1 January of a Gregorian year. Used only for ranking. */
function jdnOfYearStart(year: number): number {
  const a = Math.floor((14 - 1) / 12);
  const y = year + 4800 - a;
  const m = 1 + 12 * a - 3;
  return (
    1 +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

export async function searchPeople(
  db: Database,
  options: SearchOptions,
): Promise<PersonSearchHit[]> {
  const { text, year } = splitYear(options.query);
  const folded = foldName(text);
  if (folded.length === 0) return [];

  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const threshold = options.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  // A year the researcher typed, as a sort key. Null when they typed none, in
  // which case the CASE below collapses to zero and ranking is name-only.
  const yearJdn = year === null ? null : jdnOfYearStart(year);

  const rows = await db.$queryRaw<RawHit[]>(sql`
    SELECT
      p."id",
      p."displayName",
      p."searchName",
      p."livingStatus"::text AS "livingStatus",
      p."birthSortJdn",
      p."lifespanEarliestJdn",
      p."lifespanLatestJdn",
      (
        CASE
          WHEN p."searchName" = ${folded} THEN 1.0
          WHEN p."searchName" LIKE ${folded + '%'} THEN 0.92
          WHEN p."searchName" LIKE ${'%' + folded + '%'} THEN 0.84
          ELSE similarity(p."searchName", ${folded})
        END
        -- A typed year pulls near-contemporaries up without excluding anyone:
        -- the record off by a year is the one being reconciled.
        - CASE
            WHEN ${yearJdn}::int IS NULL OR p."birthSortJdn" IS NULL THEN 0
            ELSE LEAST(ABS(p."birthSortJdn" - ${yearJdn}::int) / 36525.0, 0.25)
          END
      )::float8 AS "score"
    FROM "people" p
    WHERE p."treeId" = ${options.treeId}::uuid
      AND p."deletedAt" IS NULL
      AND (
        p."searchName" LIKE ${'%' + folded + '%'}
        OR similarity(p."searchName", ${folded}) >= ${threshold}
      )
    ORDER BY "score" DESC, p."birthSortJdn" ASC NULLS LAST, p."displayName" ASC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    personId: row.id,
    displayName: row.displayName,
    searchName: row.searchName,
    livingStatus: row.livingStatus,
    birthSortJdn: row.birthSortJdn,
    lifespanEarliestJdn: row.lifespanEarliestJdn,
    lifespanLatestJdn: row.lifespanLatestJdn,
    score: row.score,
    // Said out loud in the UI: a fuzzy hit is a suggestion, and presenting it
    // as though the researcher's spelling matched would be a small lie about
    // what the archive contains.
    approximate: !row.searchName.includes(folded),
  }));
}

export interface PlaceSearchHit {
  readonly placeId: string;
  readonly name: string;
  readonly personCount: number;
}

/** Places, for jumping straight to where a family lived. */
export async function searchPlaces(
  db: Database,
  options: SearchOptions,
): Promise<PlaceSearchHit[]> {
  const folded = foldName(options.query);
  if (folded.length === 0) return [];
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const threshold = options.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  const rows = await db.$queryRaw<{ id: string; name: string; personCount: bigint }[]>(sql`
    SELECT
      pl."id",
      pl."name",
      COUNT(DISTINCT ep."personId") AS "personCount"
    FROM "places" pl
    LEFT JOIN "events" e ON e."placeId" = pl."id" AND e."deletedAt" IS NULL
    LEFT JOIN "event_participants" ep ON ep."eventId" = e."id"
    WHERE pl."treeId" = ${options.treeId}::uuid
      AND (
        pl."normalisedName" LIKE ${'%' + folded + '%'}
        OR similarity(pl."normalisedName", ${folded}) >= ${threshold}
      )
    GROUP BY pl."id", pl."name", pl."normalisedName"
    ORDER BY similarity(pl."normalisedName", ${folded}) DESC, pl."name" ASC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    placeId: row.id,
    name: row.name,
    // COUNT returns bigint over the wire; leaving it would put "3n" on screen.
    personCount: Number(row.personCount),
  }));
}
