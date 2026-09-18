import { sql } from '../../generated/client/internal/prismaNamespace';
import type { Database } from '../client';

/**
 * How much of each person's record is backed by a source.
 *
 * The same measure the archive page publishes for the whole tree — an event is
 * sourced when at least one citation points at it — taken person by person.
 * Only the events of a person's own life count — those they are the subject
 * of, and their marriages, which belong to both spouses equally. Being a
 * witness at a cousin's wedding, or the parent named in a child's baptism,
 * says nothing about how well that person's own life is documented.
 *
 * One aggregate query, whatever the size of the tree. A person with no events
 * is absent from the result rather than present with zeros: "nothing recorded"
 * and "recorded, none of it sourced" are different states, and a caller that
 * needs a default should choose it knowingly.
 */

export interface EvidenceCoverage {
  readonly events: number;
  readonly cited: number;
}

interface CoverageRow {
  readonly personId: string;
  readonly events: number;
  readonly cited: number;
}

export async function loadEvidenceCoverage(
  db: Database,
  treeId: string,
): Promise<Map<string, EvidenceCoverage>> {
  const rows = await db.$queryRaw<CoverageRow[]>(sql`
    SELECT
      ep."personId",
      COUNT(DISTINCT e."id")::int AS "events",
      COUNT(DISTINCT e."id") FILTER (
        WHERE EXISTS (SELECT 1 FROM "citations" c WHERE c."eventId" = e."id")
      )::int AS "cited"
    FROM "event_participants" ep
    JOIN "events" e ON e."id" = ep."eventId" AND e."deletedAt" IS NULL
    JOIN "people" p ON p."id" = ep."personId" AND p."deletedAt" IS NULL
    WHERE e."treeId" = ${treeId}::uuid
      AND ep."role" IN ('PRINCIPAL', 'SPOUSE')
    GROUP BY ep."personId"
  `);

  return new Map(rows.map((row) => [row.personId, { events: row.events, cited: row.cited }]));
}
