import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  JDN_UNIX_EPOCH,
  dateToJdn,
  frenchRepublicanToJdn,
  gregorianToJdn,
  jdnToFrenchRepublican,
  jdnToGregorian,
  jdnToJulian,
  julianToJdn,
} from './calendar.js';

describe('Gregorian <-> JDN', () => {
  // Anchors taken from published astronomical tables. If any of these move,
  // every date in the product has silently shifted.
  it.each([
    ['unix epoch', 1970, 1, 1, JDN_UNIX_EPOCH],
    ['J2000', 2000, 1, 1, 2_451_545],
    ['Gregorian reform, first day', 1582, 10, 15, 2_299_161],
    ['French Republican epoch', 1792, 9, 22, 2_375_840],
  ])('%s', (_label, year, month, day, expected) => {
    expect(gregorianToJdn(year, month, day)).toBe(expected);
  });

  it('round-trips every day across six centuries', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2_200_000, max: 2_500_000 }), (jdn) => {
        const parts = jdnToGregorian(jdn);
        expect(gregorianToJdn(parts.year, parts.month, parts.day)).toBe(jdn);
      }),
      { numRuns: 2000 },
    );
  });

  it('produces strictly increasing numbers for increasing dates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1500, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (year, month, day) => {
          const a = gregorianToJdn(year, month, day);
          const b = gregorianToJdn(year, month, day + 1);
          expect(b).toBe(a + 1);
        },
      ),
    );
  });

  it('agrees with JS Date on the range JS Date handles correctly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2_400_000, max: 2_470_000 }), (jdn) => {
        const parts = jdnToGregorian(jdn);
        const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
        expect(dateToJdn(new Date(asUtc))).toBe(jdn);
      }),
      { numRuns: 500 },
    );
  });
});

describe('Julian <-> JDN', () => {
  it('places the Gregorian reform correctly', () => {
    // 4 October 1582 (Julian) was immediately followed by 15 October 1582
    // (Gregorian): consecutive days, two calendars.
    expect(julianToJdn(1582, 10, 4)).toBe(2_299_160);
    expect(gregorianToJdn(1582, 10, 15)).toBe(2_299_161);
  });

  it('round-trips', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2_200_000, max: 2_500_000 }), (jdn) => {
        const parts = jdnToJulian(jdn);
        expect(julianToJdn(parts.year, parts.month, parts.day)).toBe(jdn);
      }),
      { numRuns: 2000 },
    );
  });

  it('diverges from Gregorian by the expected drift', () => {
    // By 1900 the Julian calendar lagged the Gregorian by 13 days.
    const gregorian = gregorianToJdn(1900, 3, 14);
    const julian = julianToJdn(1900, 3, 1);
    expect(gregorian).toBe(julian);
  });
});

describe('French Republican <-> JDN', () => {
  it('anchors 1 Vendemiaire an I to 22 September 1792', () => {
    expect(frenchRepublicanToJdn(1, 1, 1)).toBe(gregorianToJdn(1792, 9, 22));
  });

  it('places 18 Brumaire an VIII on 9 November 1799', () => {
    // The coup that ended the Directory — a fixed point every French history
    // textbook agrees on, which makes it a good conversion anchor.
    expect(frenchRepublicanToJdn(8, 2, 18)).toBe(gregorianToJdn(1799, 11, 9));
  });

  it('places 9 Thermidor an II on 27 July 1794', () => {
    expect(frenchRepublicanToJdn(2, 11, 9)).toBe(gregorianToJdn(1794, 7, 27));
  });

  // These two bracket the sextile years III and VII. Before the leap-rule fix
  // the calendar drifted one day after an III, so they are kept as regression
  // anchors rather than merged into a single case.
  it('opens an IX on 23 September 1800', () => {
    expect(frenchRepublicanToJdn(9, 1, 1)).toBe(gregorianToJdn(1800, 9, 23));
  });

  it('opens an XIV on 23 September 1805', () => {
    expect(frenchRepublicanToJdn(14, 1, 1)).toBe(gregorianToJdn(1805, 9, 23));
  });

  it('round-trips across the calendar period of legal use', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 14 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 30 }),
        (year, month, day) => {
          const jdn = frenchRepublicanToJdn(year, month, day);
          const back = jdnToFrenchRepublican(jdn);
          expect(back).toEqual({ year, month, day });
        },
      ),
    );
  });
});
