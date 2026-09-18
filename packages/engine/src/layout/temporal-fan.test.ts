import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { gregorianToJdn } from '@chronolignee/domain';
import { layoutTemporalFan, type FanAncestor } from './temporal-fan';

/**
 * The temporal fan.
 *
 * Geometry that encodes claims about time, so the claims are what is tested:
 * where an ancestor sits says when they were born, and how thick they are
 * says how sure the records are.
 */

const SUBJECT_1822 = {
  birthEarliestJdn: gregorianToJdn(1822, 6, 12),
  birthLatestJdn: gregorianToJdn(1822, 6, 12),
};

function exact(personId: string, sosa: number, year: number, month = 1, day = 1): FanAncestor {
  const jdn = gregorianToJdn(year, month, day);
  return { personId, sosa, birthEarliestJdn: jdn, birthLatestJdn: jdn };
}

function yearOnly(personId: string, sosa: number, year: number): FanAncestor {
  return {
    personId,
    sosa,
    birthEarliestJdn: gregorianToJdn(year, 1, 1),
    birthLatestJdn: gregorianToJdn(year, 12, 31),
  };
}

describe('position around the fan', () => {
  it('puts the father on the first half and the mother on the second', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [
      exact('father', 2, 1790),
      exact('mother', 3, 1795),
    ]);
    const father = layout.sectors.find((s) => s.personId === 'father');
    const mother = layout.sectors.find((s) => s.personId === 'mother');
    expect([father?.startFraction, father?.endFraction]).toEqual([0, 0.5]);
    expect([mother?.startFraction, mother?.endFraction]).toEqual([0.5, 1]);
  });

  it('divides each sector between the two parents of that ancestor', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [
      exact('ff', 4, 1760),
      exact('fm', 5, 1765),
      exact('mf', 6, 1768),
      exact('mm', 7, 1770),
    ]);
    expect(layout.sectors.map((s) => [s.startFraction, s.endFraction])).toEqual([
      [0, 0.25],
      [0.25, 0.5],
      [0.5, 0.75],
      [0.75, 1],
    ]);
  });

  it('draws a collapsed ancestor at every position they hold', () => {
    // Pedigree collapse is shown, not deduplicated: one person, two sectors.
    const layout = layoutTemporalFan(SUBJECT_1822, [
      exact('shared', 10, 1740),
      exact('shared', 12, 1740),
    ]);
    expect(layout.sectors.filter((s) => s.personId === 'shared')).toHaveLength(2);
  });
});

describe('distance from the centre is time', () => {
  it('places an ancestor at the years between the two births', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [exact('father', 2, 1792, 6, 12)]);
    const father = layout.sectors[0];
    expect(father?.innerYears).toBeCloseTo(30, 1);
    expect(father?.outerYears).toBeCloseTo(30, 1);
  });

  it('lets two branches of different generation lengths sit at different radii', () => {
    // The whole reason the rings are years: two great-grandparents, same
    // generation, sixty years apart in time.
    const layout = layoutTemporalFan(SUBJECT_1822, [
      exact('young-line', 8, 1745),
      exact('old-line', 15, 1685),
    ]);
    const young = layout.sectors.find((s) => s.personId === 'young-line');
    const old = layout.sectors.find((s) => s.personId === 'old-line');
    expect(young?.generation).toBe(old?.generation);
    expect((old?.outerYears ?? 0) - (young?.outerYears ?? 0)).toBeCloseTo(60, 0);
  });
});

describe('thickness is uncertainty', () => {
  it('draws an exact date as a hairline', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [exact('a', 2, 1790, 3, 4)]);
    const sector = layout.sectors[0];
    expect((sector?.outerYears ?? 0) - (sector?.innerYears ?? 0)).toBeLessThan(0.01);
    expect(sector?.uncertain).toBe(false);
  });

  it('draws a year without a day as a band about a year wide', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [yearOnly('a', 2, 1790)]);
    const sector = layout.sectors[0];
    expect((sector?.outerYears ?? 0) - (sector?.innerYears ?? 0)).toBeCloseTo(1, 1);
  });

  it('draws "vers 1750" as a wide band and says it is uncertain', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [
      {
        personId: 'a',
        sosa: 4,
        birthEarliestJdn: gregorianToJdn(1745, 1, 1),
        birthLatestJdn: gregorianToJdn(1755, 12, 31),
      },
    ]);
    const sector = layout.sectors[0];
    expect((sector?.outerYears ?? 0) - (sector?.innerYears ?? 0)).toBeGreaterThan(10);
    expect(sector?.uncertain).toBe(true);
  });

  it('gives "avant 1750" no outer edge instead of inventing one', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [
      {
        personId: 'a',
        sosa: 4,
        birthEarliestJdn: null,
        birthLatestJdn: gregorianToJdn(1750, 1, 1),
      },
    ]);
    expect(layout.sectors[0]?.outerOpen).toBe(true);
    expect(layout.sectors[0]?.innerOpen).toBe(false);
  });
});

describe('what cannot be placed', () => {
  it('lists an undated ancestor rather than putting them on a ring', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [
      exact('dated', 2, 1790),
      { personId: 'undated', sosa: 3, birthEarliestJdn: null, birthLatestJdn: null },
    ]);
    expect(layout.sectors.map((s) => s.personId)).toEqual(['dated']);
    expect(layout.unplaced).toEqual([{ personId: 'undated', sosa: 3 }]);
  });

  it('places nobody when the subject has no birth date to measure from', () => {
    const layout = layoutTemporalFan({ birthEarliestJdn: null, birthLatestJdn: null }, [
      exact('father', 2, 1790),
    ]);
    expect(layout.referenceYear).toBeNull();
    expect(layout.sectors).toEqual([]);
    expect(layout.unplaced).toHaveLength(1);
  });

  it('flags an ancestor born after the subject instead of hiding them', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [exact('impossible', 2, 1830)]);
    expect(layout.sectors[0]?.anomalous).toBe(true);
  });
});

describe('the rings', () => {
  it('fall on round calendar years, labelled as years', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [exact('far', 16, 1690)]);
    expect(layout.referenceYear).toBe(1822);
    for (const ring of layout.rings) {
      expect(ring.year % 25 === 0 || ring.year % 50 === 0).toBe(true);
      expect(ring.offsetYears).toBe(1822 - ring.year);
    }
    expect(layout.rings[0]?.year).toBe(1800);
  });

  it('reach past the furthest ancestor, and not absurdly further', () => {
    const layout = layoutTemporalFan(SUBJECT_1822, [exact('far', 16, 1690)]);
    const outermost = Math.max(...layout.rings.map((ring) => ring.offsetYears));
    expect(outermost).toBeGreaterThanOrEqual(layout.maxYears);
    expect(outermost - layout.maxYears).toBeLessThanOrEqual(50);
  });
});

describe('properties', () => {
  it('keeps every sector inside the fan and every band the right way round', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            sosa: fc.integer({ min: 2, max: 1023 }),
            year: fc.integer({ min: 1600, max: 1820 }),
            width: fc.integer({ min: 0, max: 20 }),
          }),
          { maxLength: 60 },
        ),
        (rows) => {
          const layout = layoutTemporalFan(
            SUBJECT_1822,
            rows.map((row, index) => ({
              personId: `p${index}`,
              sosa: row.sosa,
              birthEarliestJdn: gregorianToJdn(row.year, 1, 1),
              birthLatestJdn: gregorianToJdn(row.year + row.width, 1, 1),
            })),
          );
          for (const sector of layout.sectors) {
            expect(sector.startFraction).toBeGreaterThanOrEqual(0);
            expect(sector.endFraction).toBeLessThanOrEqual(1);
            expect(sector.startFraction).toBeLessThan(sector.endFraction);
            expect(sector.innerYears).toBeLessThanOrEqual(sector.outerYears);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
