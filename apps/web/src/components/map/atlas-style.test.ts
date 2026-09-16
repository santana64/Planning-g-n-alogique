import { describe, expect, it } from 'vitest';
import { arcsToGeoJson, greatCircle, pointsToGeoJson } from './atlas-style';
import type { AtlasArc, AtlasPoint } from '@/server/atlas';

/**
 * The map's geometry.
 *
 * Worth testing because every mistake here is invisible until someone who
 * knows the region looks at it: a route through the wrong continent, a line
 * that streaks across the map at the dateline, a dot that appears a century
 * before anything was recorded there.
 */

function point(partial: Partial<AtlasPoint> & Pick<AtlasPoint, 'placeId'>): AtlasPoint {
  return {
    name: partial.placeId,
    longitude: 0,
    latitude: 0,
    eventCount: 1,
    personCount: 1,
    earliestJdn: null,
    latestJdn: null,
    ...partial,
  };
}

function arc(partial: Partial<AtlasArc>): AtlasArc {
  return {
    fromPlaceId: 'a',
    toPlaceId: 'b',
    fromLongitude: 0,
    fromLatitude: 0,
    toLongitude: 10,
    toLatitude: 10,
    weight: 1,
    earliestJdn: 0,
    latestJdn: 0,
    ...partial,
  };
}

describe('great-circle arcs', () => {
  it('starts and ends exactly where it was told to', () => {
    const line = greatCircle(0.1079, 49.4944, -58.3816, -34.6037);
    expect(line[0]?.[0]).toBeCloseTo(0.1079, 3);
    expect(line[0]?.[1]).toBeCloseTo(49.4944, 3);
    expect(line[line.length - 1]?.[0]).toBeCloseTo(-58.3816, 3);
    expect(line[line.length - 1]?.[1]).toBeCloseTo(-34.6037, 3);
  });

  it('routes Le Havre to Buenos Aires over the Atlantic, not through Africa', () => {
    // A straight segment in lon/lat between these two crosses the Sahara.
    // The great circle stays west of the African coast the whole way.
    const line = greatCircle(0.1079, 49.4944, -58.3816, -34.6037);
    const inAfrica = line.filter(([lon, lat]) => lon > 0 && lat < 35 && lat > -35);
    expect(inAfrica).toEqual([]);
  });

  it('bows north between two points at the same latitude', () => {
    // The shortest path between two northern-hemisphere points is not the
    // parallel they share; a flat line here is the signature of the bug.
    const line = greatCircle(-70, 45, 10, 45);
    const highest = Math.max(...line.map(([, lat]) => lat));
    expect(highest).toBeGreaterThan(45.5);
  });

  it('does not streak across the map at the dateline', () => {
    const line = greatCircle(170, 10, -170, 10);
    for (let index = 1; index < line.length; index += 1) {
      const step = Math.abs((line[index]?.[0] ?? 0) - (line[index - 1]?.[0] ?? 0));
      // Unwrapped longitudes advance smoothly; a wrap shows as a ~340° jump.
      expect(step).toBeLessThan(180);
    }
  });

  it('falls back to a segment for two identical points', () => {
    const line = greatCircle(2.3522, 48.8566, 2.3522, 48.8566);
    expect(line).toHaveLength(2);
    expect(line[0]).toEqual([2.3522, 48.8566]);
  });
});

describe('the time cursor', () => {
  it('shows a place only once something is recorded there', () => {
    const points = [
      point({ placeId: 'tours', earliestJdn: 2_300_000 }),
      point({ placeId: 'buenos-aires', earliestJdn: 2_400_000 }),
    ];

    const early = pointsToGeoJson(points, 2_350_000);
    expect(early.features.map((f) => f.properties['placeId'])).toEqual(['tours']);
  });

  it('shows every place when there is no cursor', () => {
    const points = [point({ placeId: 'a' }), point({ placeId: 'b', earliestJdn: 2_400_000 })];
    expect(pointsToGeoJson(points, null).features).toHaveLength(2);
  });

  it('draws a move only once it has completed', () => {
    // Showing the arc from the departure would put a family on two continents
    // at once for the length of a crossing.
    const arcs = [arc({ earliestJdn: 2_400_000, latestJdn: 2_400_400 })];
    expect(arcsToGeoJson(arcs, 2_400_200).features).toEqual([]);
    expect(arcsToGeoJson(arcs, 2_400_500).features).toHaveLength(1);
  });

  it('carries the weight through, so a repeated route reads as heavier', () => {
    const features = arcsToGeoJson([arc({ weight: 8 })], null).features;
    expect(features[0]?.properties['weight']).toBe(8);
  });
});
