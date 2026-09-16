import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { gregorianToJdn } from './calendar';
import {
  ageAt,
  dateContains,
  intervalsOverlap,
  isBefore,
  resolveLifespan,
  unknownDate,
  wasAliveOn,
  wasAliveOnIntervals,
} from './interval';
import { parseGenealogicalDate } from './parse';

const parse = (s: string) => parseGenealogicalDate(s);
const day = (y: number, m: number, d: number) => gregorianToJdn(y, m, d);

const TODAY = day(2026, 9, 15);
const VE_DAY = day(1945, 5, 8);

describe('dateContains', () => {
  it('is YES only when the window is a single day', () => {
    expect(dateContains(parse('8 MAY 1945'), VE_DAY)).toBe('YES');
  });

  it('is MAYBE when the day falls inside a wider window', () => {
    expect(dateContains(parse('MAY 1945'), VE_DAY)).toBe('MAYBE');
    expect(dateContains(parse('1945'), VE_DAY)).toBe('MAYBE');
    expect(dateContains(parse('ABT 1945'), VE_DAY)).toBe('MAYBE');
  });

  it('is YES inside a bounded period, because a period asserts its whole span', () => {
    expect(dateContains(parse('FROM 1940 TO 1950'), VE_DAY)).toBe('YES');
  });

  it('is MAYBE inside a BETWEEN window, because only one moment is asserted', () => {
    expect(dateContains(parse('BET 1940 AND 1950'), VE_DAY)).toBe('MAYBE');
  });

  it('is NO outside the window', () => {
    expect(dateContains(parse('1950'), VE_DAY)).toBe('NO');
    expect(dateContains(parse('BEF 1940'), VE_DAY)).toBe('NO');
    expect(dateContains(parse('AFT 1950'), VE_DAY)).toBe('NO');
  });

  it('is MAYBE for a date with no position at all', () => {
    expect(dateContains(unknownDate(), VE_DAY)).toBe('MAYBE');
  });
});

describe('isBefore', () => {
  it('is YES for disjoint ordered windows', () => {
    expect(isBefore(parse('1850').interval, parse('1900').interval)).toBe('YES');
  });

  it('is NO when the order is reversed', () => {
    expect(isBefore(parse('1900').interval, parse('1850').interval)).toBe('NO');
  });

  it('is MAYBE when the windows overlap', () => {
    expect(isBefore(parse('ABT 1850').interval, parse('ABT 1852').interval)).toBe('MAYBE');
  });
});

describe('intervalsOverlap', () => {
  it('is NO for clearly separate lives', () => {
    expect(intervalsOverlap(parse('1700').interval, parse('1900').interval)).toBe('NO');
  });

  it('is YES for two fully known overlapping windows', () => {
    expect(
      intervalsOverlap(parse('FROM 1900 TO 1950').interval, parse('FROM 1940 TO 1960').interval),
    ).toBe('YES');
  });

  it('is MAYBE when either side is open-ended', () => {
    expect(intervalsOverlap(parse('AFT 1900').interval, parse('1950').interval)).toBe('MAYBE');
  });
});

describe('wasAliveOn — the question behind "Who was alive?"', () => {
  it('answers YES when birth and death both bracket the day with certainty', () => {
    const answer = wasAliveOn(
      { birth: parse('3 MAR 1901'), death: parse('17 NOV 1976'), isDeceased: true },
      VE_DAY,
      TODAY,
    );
    expect(answer).toBe('YES');
  });

  it('answers NO for someone born after the day', () => {
    expect(
      wasAliveOn({ birth: parse('1950'), death: parse('2010'), isDeceased: true }, VE_DAY, TODAY),
    ).toBe('NO');
  });

  it('answers NO for someone who died before the day', () => {
    expect(
      wasAliveOn({ birth: parse('1850'), death: parse('1900'), isDeceased: true }, VE_DAY, TODAY),
    ).toBe('NO');
  });

  it('answers MAYBE when an uncertain birth straddles the day', () => {
    // Born "about 1945": could be before or after 8 May. We must not claim.
    expect(
      wasAliveOn(
        { birth: parse('ABT 1945'), death: parse('2000'), isDeceased: true },
        VE_DAY,
        TODAY,
      ),
    ).toBe('MAYBE');
  });

  it('answers MAYBE when the death is unrecorded but the lifespan allows it', () => {
    expect(
      wasAliveOn({ birth: parse('3 MAR 1901'), death: null, isDeceased: true }, VE_DAY, TODAY),
    ).toBe('MAYBE');
  });

  it('answers NO when the maximum-lifespan rule rules the day out', () => {
    // Born 1750, death unrecorded. Nobody in this tree was alive in 1945.
    expect(wasAliveOn({ birth: parse('1750'), death: null, isDeceased: true }, VE_DAY, TODAY)).toBe(
      'NO',
    );
  });

  it('answers YES for a living person born before the day', () => {
    expect(
      wasAliveOn({ birth: parse('3 MAR 1930'), death: null, isDeceased: false }, VE_DAY, TODAY),
    ).toBe('YES');
  });

  it('answers MAYBE for a person with no dates at all', () => {
    expect(wasAliveOn({ birth: null, death: null }, VE_DAY, TODAY)).toBe('MAYBE');
  });

  it('never answers YES when either bound is unknown', () => {
    fc.assert(
      fc.property(fc.integer({ min: day(1700, 1, 1), max: day(2020, 1, 1) }), (jdn) => {
        const answer = wasAliveOn(
          { birth: null, death: parse('1900'), isDeceased: true },
          jdn,
          TODAY,
        );
        expect(answer).not.toBe('YES');
      }),
      { numRuns: 300 },
    );
  });

  it('is monotone: outside the resolved lifespan the answer is always NO', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1700, max: 1990 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: day(1600, 1, 1), max: day(2100, 1, 1) }),
        (birthYear, lifespan, probe) => {
          const input = {
            birth: parse(String(birthYear)),
            death: parse(String(birthYear + lifespan)),
            isDeceased: true,
          };
          const resolved = resolveLifespan(input, TODAY);
          const answer = wasAliveOn(input, probe, TODAY);
          const earliest = resolved.interval.earliest;
          const latest = resolved.interval.latest;
          if (earliest !== null && probe < earliest) expect(answer).toBe('NO');
          if (latest !== null && probe > latest) expect(answer).toBe('NO');
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('resolveLifespan', () => {
  it('flags an inferred upper bound rather than pretending it was recorded', () => {
    const resolved = resolveLifespan(
      { birth: parse('1750'), death: null, isDeceased: true },
      TODAY,
    );
    expect(resolved.latestIsInferred).toBe(true);
    expect(resolved.interval.latest).not.toBeNull();
  });

  it('does not flag a recorded upper bound as inferred', () => {
    const resolved = resolveLifespan(
      { birth: parse('1750'), death: parse('1800'), isDeceased: true },
      TODAY,
    );
    expect(resolved.latestIsInferred).toBe(false);
  });

  it('reports a person with no dates as undated', () => {
    expect(resolveLifespan({ birth: null, death: null }, TODAY).undated).toBe(true);
  });

  it('caps a living person at today, not at the maximum lifespan', () => {
    const resolved = resolveLifespan(
      { birth: parse('2000'), death: null, isDeceased: false },
      TODAY,
    );
    expect(resolved.interval.latest).toBe(TODAY);
  });
});

describe('ageAt', () => {
  it('gives an exact age for an exact birth date', () => {
    expect(ageAt(parse('8 MAY 1900'), VE_DAY)).toEqual({ min: 45, max: 45 });
  });

  it('gives a range for an uncertain birth date', () => {
    const age = ageAt(parse('ABT 1900'), VE_DAY);
    expect(age).not.toBeNull();
    expect(age!.min).toBeLessThan(age!.max);
  });

  it('returns null when no birth position is known', () => {
    expect(ageAt(null, VE_DAY)).toBeNull();
    expect(ageAt(unknownDate(), VE_DAY)).toBeNull();
  });

  it('never reports a maximum below its minimum', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1700, max: 2000 }), (year) => {
        const age = ageAt(parse(`ABT ${year}`), TODAY);
        if (age) expect(age.max).toBeGreaterThanOrEqual(age.min);
      }),
      { numRuns: 300 },
    );
  });
});

describe('wasAliveOnIntervals', () => {
  // The interval form exists so a dragged time cursor can recompute every
  // person per frame without rebuilding date objects. It must agree with the
  // date form exactly, or the timeline and the rest of the product would
  // answer the same question differently.
  const cases: ReadonlyArray<[string, string | null, string | null, boolean | undefined]> = [
    ['both exact, bracketing', '3 MAR 1901', '17 NOV 1976', true],
    ['born after', '1950', '2010', true],
    ['died before', '1850', '1900', true],
    ['uncertain birth straddling', 'ABT 1945', '2000', true],
    ['no death recorded', '3 MAR 1901', null, true],
    ['maximum-lifespan rule applies', '1750', null, true],
    ['living person', '3 MAR 1930', null, false],
    ['no dates at all', null, null, undefined],
    ['only a death', null, '1900', true],
    ['open-ended birth', 'AFT 1900', '1980', true],
  ];

  it.each(cases)('agrees with the date form: %s', (_label, birth, death, isDeceased) => {
    const birthDate = birth ? parse(birth) : null;
    const deathDate = death ? parse(death) : null;

    for (const probe of [VE_DAY, day(1800, 1, 1), day(1960, 6, 1), day(2020, 1, 1)]) {
      const viaDates = wasAliveOn({ birth: birthDate, death: deathDate, isDeceased }, probe, TODAY);
      const viaIntervals = wasAliveOnIntervals(
        {
          birth: birthDate?.interval ?? { earliest: null, latest: null },
          death: deathDate?.interval ?? { earliest: null, latest: null },
          isDeceased,
        },
        probe,
        TODAY,
      );
      expect(viaIntervals).toBe(viaDates);
    }
  });

  it('agrees with the date form for arbitrary lifespans and probes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1700, max: 1990 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: day(1600, 1, 1), max: day(2100, 1, 1) }),
        fc.constantFrom('', 'ABT ', 'BEF ', 'AFT '),
        (birthYear, lifespan, probe, qualifier) => {
          const birth = parse(`${qualifier}${birthYear}`);
          const death = parse(String(birthYear + lifespan));
          const input = { birth, death, isDeceased: true };

          expect(
            wasAliveOnIntervals(
              { birth: birth.interval, death: death.interval, isDeceased: true },
              probe,
              TODAY,
            ),
          ).toBe(wasAliveOn(input, probe, TODAY));
        },
      ),
      { numRuns: 1000 },
    );
  });
});
