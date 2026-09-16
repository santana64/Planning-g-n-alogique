import { sql } from '../../generated/client/internal/prismaNamespace';
import type { Database } from '../client';

/**
 * Where a family was, and when it moved.
 *
 * Genealogy is geography as much as it is graph: a surname that appears in one
 * commune for two centuries and then in Buenos Aires is not two families, it
 * is an emigration, and the map is where that becomes visible.
 *
 * Two shapes come out of here. Places, aggregated with the span of the events
 * recorded at them — a dot that knows it covers 1702 to 1889 can be shown or
 * hidden as the time cursor moves. And journeys: one person's dated,
 * placed events in order, paired into the moves between them.
 */

export interface AtlasPlace {
  readonly placeId: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly countryCode: string | null;
  readonly type: string;
  readonly eventCount: number;
  readonly personCount: number;
  /** Span of the dated events recorded here. Null when none carry a date. */
  readonly earliestJdn: number | null;
  readonly latestJdn: number | null;
}

export interface AtlasLeg {
  readonly personId: string;
  readonly fromPlaceId: string;
  readonly toPlaceId: string;
  /** When they were last recorded at the origin. */
  readonly departureJdn: number;
  /** When they were first recorded at the destination. */
  readonly arrivalJdn: number;
}

export interface AtlasData {
  readonly places: readonly AtlasPlace[];
  readonly legs: readonly AtlasLeg[];
  /** People whose movements were withheld, so the map can say so. */
  readonly withheldPeople: number;
}

interface PlaceRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  countryCode: string | null;
  type: string;
  eventCount: bigint;
  personCount: bigint;
  earliestJdn: number | null;
  latestJdn: number | null;
}

interface StopRow {
  personId: string;
  placeId: string;
  dateSortJdn: number;
  livingStatus: string;
}

export interface AtlasOptions {
  readonly treeId: string;
  /**
   * Whether living people must be left out of the journey layer.
   *
   * A single arc from one commune to one city, dated, is identifying even
   * without a name attached to it. Place totals stay aggregate and are safe;
   * an individual's path is not.
   */
  readonly redactLiving: boolean;
}

export async function loadAtlas(db: Database, options: AtlasOptions): Promise<AtlasData> {
  const placeRows = await db.$queryRaw<PlaceRow[]>(sql`
    SELECT
      pl."id",
      pl."name",
      pl."latitude",
      pl."longitude",
      pl."countryCode",
      pl."type"::text AS "type",
      COUNT(DISTINCT e."id")            AS "eventCount",
      COUNT(DISTINCT ep."personId")     AS "personCount",
      MIN(e."dateSortJdn")              AS "earliestJdn",
      MAX(e."dateSortJdn")              AS "latestJdn"
    FROM "places" pl
    JOIN "events" e
      ON e."placeId" = pl."id" AND e."deletedAt" IS NULL
    JOIN "event_participants" ep ON ep."eventId" = e."id"
    JOIN "people" p ON p."id" = ep."personId" AND p."deletedAt" IS NULL
    WHERE pl."treeId" = ${options.treeId}::uuid
      -- A place with no coordinates cannot be drawn, and inventing one from
      -- its name is precisely the fake precision this product refuses.
      AND pl."latitude" IS NOT NULL
      AND pl."longitude" IS NOT NULL
    GROUP BY pl."id", pl."name", pl."latitude", pl."longitude", pl."countryCode", pl."type"
    ORDER BY COUNT(DISTINCT e."id") DESC
  `);

  const stopRows = await db.$queryRaw<StopRow[]>(sql`
    SELECT
      ep."personId",
      e."placeId",
      e."dateSortJdn",
      p."livingStatus"::text AS "livingStatus"
    FROM "events" e
    JOIN "event_participants" ep ON ep."eventId" = e."id"
    JOIN "people" p ON p."id" = ep."personId" AND p."deletedAt" IS NULL
    JOIN "places" pl
      ON pl."id" = e."placeId" AND pl."latitude" IS NOT NULL AND pl."longitude" IS NOT NULL
    WHERE e."treeId" = ${options.treeId}::uuid
      AND e."deletedAt" IS NULL
      AND e."placeId" IS NOT NULL
      AND e."dateSortJdn" IS NOT NULL
    ORDER BY ep."personId", e."dateSortJdn" ASC
  `);

  const legs: AtlasLeg[] = [];
  const withheld = new Set<string>();

  let currentPerson: string | null = null;
  let lastPlace: string | null = null;
  let lastJdn = 0;

  for (const stop of stopRows) {
    if (stop.personId !== currentPerson) {
      currentPerson = stop.personId;
      lastPlace = null;
    }

    if (options.redactLiving && stop.livingStatus === 'LIVING') {
      withheld.add(stop.personId);
      lastPlace = null;
      continue;
    }

    // Consecutive events at the same place are a stay, not a move. Drawing an
    // arc from a place to itself would turn sixty parish records into sixty
    // migrations.
    if (lastPlace !== null && lastPlace !== stop.placeId) {
      legs.push({
        personId: stop.personId,
        fromPlaceId: lastPlace,
        toPlaceId: stop.placeId,
        departureJdn: lastJdn,
        arrivalJdn: stop.dateSortJdn,
      });
    }

    lastPlace = stop.placeId;
    lastJdn = stop.dateSortJdn;
  }

  return {
    places: placeRows.map((row) => ({
      placeId: row.id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      countryCode: row.countryCode,
      type: row.type,
      // COUNT comes back as bigint over the wire; leaving it would put "59n"
      // on screen and break JSON serialisation to the client.
      eventCount: Number(row.eventCount),
      personCount: Number(row.personCount),
      earliestJdn: row.earliestJdn,
      latestJdn: row.latestJdn,
    })),
    legs,
    withheldPeople: withheld.size,
  };
}
