import 'server-only';
import { cache } from 'react';
import { dateToJdn } from '@chronolignee/domain';
import { loadAtlas } from '@chronolignee/db';
import { db } from '@/lib/db';
import { resolveTreeAccess, type TreeAccess } from './access';

/**
 * The map's snapshot.
 *
 * Plain data, like the timeline's: no Map, no Date, no class instances. The
 * aggregation happens here, next to the database, and the client receives
 * only what it draws.
 *
 * Journeys are anonymous by construction — a leg carries a person id for
 * grouping and nothing else. The map is about where a family went, and a name
 * on an arc adds nothing to that while making every redaction decision harder.
 */

export interface AtlasPoint {
  readonly placeId: string;
  readonly name: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly eventCount: number;
  readonly personCount: number;
  readonly earliestJdn: number | null;
  readonly latestJdn: number | null;
}

export interface AtlasArc {
  readonly fromPlaceId: string;
  readonly toPlaceId: string;
  readonly fromLongitude: number;
  readonly fromLatitude: number;
  readonly toLongitude: number;
  readonly toLatitude: number;
  /** How many people made this move; the arc is drawn thicker for more. */
  readonly weight: number;
  /** The span across which this move happened, for the time cursor. */
  readonly earliestJdn: number;
  readonly latestJdn: number;
}

export interface AtlasSnapshot {
  readonly access: TreeAccess;
  readonly points: readonly AtlasPoint[];
  readonly arcs: readonly AtlasArc[];
  readonly earliestJdn: number;
  readonly latestJdn: number;
  readonly todayJdn: number;
  /** People whose movements were withheld from this viewer. */
  readonly withheldPeople: number;
  /** Places recorded in this tree that have no coordinates and cannot be drawn. */
  readonly unplacedCount: number;
}

export const loadAtlasSnapshot = cache(async (treeSlug: string): Promise<AtlasSnapshot | null> => {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return null;

  const atlas = await loadAtlas(db, {
    treeId: access.treeId,
    redactLiving: access.redactLiving,
  });

  const byId = new Map(atlas.places.map((place) => [place.placeId, place]));

  // Legs collapse into arcs: the same move made by eight siblings is one
  // route drawn eight times as thick, not eight lines on top of each other.
  const arcs = new Map<string, AtlasArc>();
  for (const leg of atlas.legs) {
    const from = byId.get(leg.fromPlaceId);
    const to = byId.get(leg.toPlaceId);
    if (!from || !to) continue;

    const key = `${leg.fromPlaceId}->${leg.toPlaceId}`;
    const existing = arcs.get(key);
    if (existing) {
      arcs.set(key, {
        ...existing,
        weight: existing.weight + 1,
        earliestJdn: Math.min(existing.earliestJdn, leg.departureJdn),
        latestJdn: Math.max(existing.latestJdn, leg.arrivalJdn),
      });
      continue;
    }

    arcs.set(key, {
      fromPlaceId: leg.fromPlaceId,
      toPlaceId: leg.toPlaceId,
      fromLongitude: from.longitude,
      fromLatitude: from.latitude,
      toLongitude: to.longitude,
      toLatitude: to.latitude,
      weight: 1,
      earliestJdn: leg.departureJdn,
      latestJdn: leg.arrivalJdn,
    });
  }

  const points: AtlasPoint[] = atlas.places.map((place) => ({
    placeId: place.placeId,
    name: place.name,
    longitude: place.longitude,
    latitude: place.latitude,
    eventCount: place.eventCount,
    personCount: place.personCount,
    earliestJdn: place.earliestJdn,
    latestJdn: place.latestJdn,
  }));

  const dated = points.flatMap((point) =>
    point.earliestJdn === null || point.latestJdn === null
      ? []
      : [point.earliestJdn, point.latestJdn],
  );
  const todayJdn = dateToJdn(new Date());

  // Places with no coordinates never reach `loadAtlas`, so they are counted
  // separately. A map that silently omits half the archive is worse than one
  // that says how much it cannot draw.
  const unplacedCount = await db.place.count({
    where: { treeId: access.treeId, OR: [{ latitude: null }, { longitude: null }] },
  });

  return {
    access,
    points,
    arcs: [...arcs.values()],
    earliestJdn: dated.length > 0 ? Math.min(...dated) : todayJdn,
    latestJdn: dated.length > 0 ? Math.max(...dated) : todayJdn,
    todayJdn,
    withheldPeople: atlas.withheldPeople,
    unplacedCount,
  };
});
