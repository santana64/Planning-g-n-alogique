import {
  privacySubjectFromColumns,
  type LivingStatus,
  type PersonPrivacy,
  type PrivacySubject,
} from '@chronolignee/domain';
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

interface ParticipationRow {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  countryCode: string | null;
  type: string;
  eventId: string;
  dateSortJdn: number | null;
  personId: string;
  livingStatus: LivingStatus;
  privacy: PersonPrivacy;
  lifespanEarliestJdn: number | null;
  lifespanLatestJdn: number | null;
  lifespanLatestInferred: boolean;
}

export interface AtlasOptions {
  readonly treeId: string;
  /**
   * Whether this viewer may not see a person — the application's single
   * privacy rule, supplied by the caller.
   *
   * A hidden person contributes nothing: not their journey, which is
   * identifying even without a name — a single dated arc from one commune to
   * one city — and not a place's totals either, whose last year alone can
   * say that someone was recorded there in 2018.
   */
  readonly isHidden: (person: PrivacySubject) => boolean;
}

export async function loadAtlas(db: Database, options: AtlasOptions): Promise<AtlasData> {
  const rows = await db.$queryRaw<ParticipationRow[]>(sql`
    SELECT
      pl."id" AS "placeId",
      pl."name",
      pl."latitude",
      pl."longitude",
      pl."countryCode",
      pl."type"::text AS "type",
      e."id" AS "eventId",
      e."dateSortJdn",
      ep."personId",
      p."livingStatus"::text AS "livingStatus",
      p."privacy"::text AS "privacy",
      p."lifespanEarliestJdn",
      p."lifespanLatestJdn",
      p."lifespanLatestInferred"
    FROM "places" pl
    JOIN "events" e ON e."placeId" = pl."id" AND e."deletedAt" IS NULL
    JOIN "event_participants" ep ON ep."eventId" = e."id"
    JOIN "people" p ON p."id" = ep."personId" AND p."deletedAt" IS NULL
    WHERE pl."treeId" = ${options.treeId}::uuid
      -- A place with no coordinates cannot be drawn, and inventing one from
      -- its name is precisely the fake precision this product refuses.
      AND pl."latitude" IS NOT NULL
      AND pl."longitude" IS NOT NULL
    ORDER BY ep."personId", e."dateSortJdn" ASC NULLS LAST
  `);

  const hiddenPeople = new Set<string>();
  const visible: ParticipationRow[] = [];
  for (const row of rows) {
    if (hiddenPeople.has(row.personId)) continue;
    if (options.isHidden(privacySubjectFromColumns(row))) {
      hiddenPeople.add(row.personId);
      continue;
    }
    visible.push(row);
  }

  // Places, aggregated over what may be shown.
  const byPlace = new Map<
    string,
    { row: ParticipationRow; events: Set<string>; people: Set<string>; dates: number[] }
  >();
  for (const row of visible) {
    let entry = byPlace.get(row.placeId);
    if (!entry) {
      entry = { row, events: new Set(), people: new Set(), dates: [] };
      byPlace.set(row.placeId, entry);
    }
    if (!entry.events.has(row.eventId) && row.dateSortJdn !== null)
      entry.dates.push(row.dateSortJdn);
    entry.events.add(row.eventId);
    entry.people.add(row.personId);
  }
  const places: AtlasPlace[] = [...byPlace.values()]
    .map(({ row, events, people, dates }) => ({
      placeId: row.placeId,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      countryCode: row.countryCode,
      type: row.type,
      eventCount: events.size,
      personCount: people.size,
      earliestJdn: dates.length > 0 ? Math.min(...dates) : null,
      latestJdn: dates.length > 0 ? Math.max(...dates) : null,
    }))
    .sort((a, b) => b.eventCount - a.eventCount || (a.name < b.name ? -1 : 1));

  // Journeys: one person's dated, placed events in order, paired into moves.
  const legs: AtlasLeg[] = [];
  let currentPerson: string | null = null;
  let lastPlace: string | null = null;
  let lastJdn = 0;
  for (const stop of visible) {
    if (stop.dateSortJdn === null) continue;
    if (stop.personId !== currentPerson) {
      currentPerson = stop.personId;
      lastPlace = null;
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

  return { places, legs, withheldPeople: hiddenPeople.size };
}
