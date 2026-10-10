import type { StyleSpecification } from 'maplibre-gl';
import type { AtlasArc, AtlasPoint } from '@/server/atlas';

/**
 * The map's style, built here rather than fetched from a provider.
 *
 * No tile URL, no API key, no external request. The basemap is a public-domain
 * Natural Earth outline shipped with the application, and everything else is
 * GeoJSON computed on the server.
 *
 * That is a deliberate limit as much as a licensing convenience: street-level
 * tiles would imply a precision the records do not have. An 1830 baptism is
 * registered in a commune, and drawing it over a rendering of today's road
 * network invites the reader to believe something the archive never said.
 */

export const BASEMAP_URL = '/basemap/countries-110m.geojson';

/**
 * A great-circle arc as a line string.
 *
 * Straight lines in longitude/latitude are wrong in a way that matters here:
 * Le Havre to Buenos Aires is an ocean crossing, and a straight segment on an
 * equirectangular projection draws it through Africa. Interpolating on the
 * sphere puts the route where the ship actually went.
 */
export function greatCircle(
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
  segments = 48,
): [number, number][] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  const lat1 = fromLat * toRad;
  const lon1 = fromLon * toRad;
  const lat2 = toLat * toRad;
  const lon2 = toLon * toRad;

  const delta =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );

  // Antipodal or identical points have no unique great circle; a straight
  // segment is the honest fallback rather than a division by zero.
  if (!Number.isFinite(delta) || delta === 0) {
    return [
      [fromLon, fromLat],
      [toLon, toLat],
    ];
  }

  const points: [number, number][] = [];
  for (let index = 0; index <= segments; index += 1) {
    const f = index / segments;
    const a = Math.sin((1 - f) * delta) / Math.sin(delta);
    const b = Math.sin(f * delta) / Math.sin(delta);

    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);

    points.push([Math.atan2(y, x) * toDeg, Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg]);
  }

  // Unwrap the dateline. Without this an arc that crosses ±180 snaps back
  // across the whole map as a horizontal streak.
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    while (current[0] - previous[0] > 180) current[0] -= 360;
    while (current[0] - previous[0] < -180) current[0] += 360;
  }

  return points;
}

export interface FeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly {
    readonly type: 'Feature';
    readonly properties: Record<string, unknown>;
    readonly geometry: { readonly type: string; readonly coordinates: unknown };
  }[];
}

/** Places visible at a moment: a dot appears once something is recorded there. */
export function pointsToGeoJson(
  points: readonly AtlasPoint[],
  cursorJdn: number | null,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points
      .filter((point) => cursorJdn === null || (point.earliestJdn ?? Infinity) <= cursorJdn)
      .map((point) => ({
        type: 'Feature' as const,
        properties: {
          placeId: point.placeId,
          name: point.name,
          eventCount: point.eventCount,
          personCount: point.personCount,
        },
        geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] },
      })),
  };
}

/** Moves that had happened by a moment. */
export function arcsToGeoJson(
  arcs: readonly AtlasArc[],
  cursorJdn: number | null,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: arcs
      // Drawn once the move has completed. Showing it from the departure
      // would put a family in two places at once for the length of a voyage.
      .filter((arc) => cursorJdn === null || arc.latestJdn <= cursorJdn)
      .map((arc) => ({
        type: 'Feature' as const,
        properties: { weight: arc.weight },
        geometry: {
          type: 'LineString' as const,
          coordinates: greatCircle(
            arc.fromLongitude,
            arc.fromLatitude,
            arc.toLongitude,
            arc.toLatitude,
          ),
        },
      })),
  };
}

/**
 * One cycle of a dash sliding along a line, in MapLibre's dash units. Swapped
 * one step at a time; animating the array itself is not something the
 * renderer interpolates.
 */
export const FLOW_DASHES: readonly [number, number, number][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
];
/**
 * Colours are sRGB hex, the design tokens' oklch values converted: the
 * MapLibre style validator rejects `oklch()`, and a rejected paint property
 * drops its whole layer — the land, the borders and the routes were not
 * drawn at all while they were written in oklch.
 */
export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      // Absolute: MapLibre fetches GeoJSON from a worker started from a blob,
      // where a root-relative path has no origin to resolve against.
      countries: {
        type: 'geojson',
        data:
          typeof window === 'undefined'
            ? BASEMAP_URL
            : new URL(BASEMAP_URL, window.location.origin).href,
      },
      places: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      arcs: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      {
        id: 'ocean',
        type: 'background',
        paint: { 'background-color': '#05080f' },
      },
      {
        id: 'land',
        type: 'fill',
        source: 'countries',
        paint: { 'fill-color': '#111720' },
      },
      {
        id: 'borders',
        type: 'line',
        source: 'countries',
        paint: { 'line-color': '#282e37', 'line-width': 0.6 },
      },
      {
        // A soft halo under each route, so a crossing reads on the dark sea.
        id: 'arcs-glow',
        type: 'line',
        source: 'arcs',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': '#dba757',
          'line-width': ['min', ['+', 4, ['*', 1.5, ['get', 'weight']]], 14],
          'line-opacity': 0.12,
          'line-blur': 6,
        },
      },
      {
        id: 'arcs',
        type: 'line',
        source: 'arcs',
        paint: {
          'line-color': '#dba757',
          // Thicker for a route more people took. Capped, because a route
          // taken by two hundred people is not a hundred times more important
          // than one taken by two.
          'line-width': ['min', ['+', 0.8, ['*', 0.5, ['get', 'weight']]], 5],
          'line-opacity': 0.55,
        },
      },
      {
        // Dashes travelling from the place left to the place reached: the
        // direction of a migration, which a still line cannot say. Still
        // under reduced motion.
        id: 'arcs-flow',
        type: 'line',
        source: 'arcs',
        paint: {
          'line-color': '#fad9a2',
          'line-width': ['min', ['+', 0.8, ['*', 0.4, ['get', 'weight']]], 3.5],
          'line-opacity': 0.85,
          'line-dasharray': FLOW_DASHES[0] ?? [0, 4, 3],
        },
      },
    ],
  };
}
