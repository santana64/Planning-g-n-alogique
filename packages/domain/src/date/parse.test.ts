import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { gregorianToJdn } from './calendar';
import { formatGenealogicalDate, formatYearOnly, toGedcomDateValue } from './format';
import { intervalWidthDays, makeDate } from './interval';
import { parseGenealogicalDate } from './parse';

const parse = (s: string) => parseGenealogicalDate(s);

describe('GEDCOM 7 date grammar', () => {
  it('parses an exact date', () => {
    const d = parse('12 JUN 1877');
    expect(d.qualifier).toBe('EXACT');
    expect(d.start).toEqual({ year: 1877, month: 6, day: 12 });
    expect(d.interval.earliest).toBe(gregorianToJdn(1877, 6, 12));
    expect(intervalWidthDays(d.interval)).toBe(0);
  });

  it('parses month precision as a month-wide window, not a point', () => {
    const d = parse('JUN 1877');
    expect(d.precision).toBe('MONTH');
    expect(d.interval.earliest).toBe(gregorianToJdn(1877, 6, 1));
    expect(d.interval.latest).toBe(gregorianToJdn(1877, 6, 30));
  });

  it('parses year precision as a year-wide window', () => {
    const d = parse('1877');
    expect(d.precision).toBe('YEAR');
    expect(intervalWidthDays(d.interval)).toBe(364);
  });

  it.each([
    ['ABT 1877', 'ABOUT'],
    ['CAL 1877', 'CALCULATED'],
    ['EST 1877', 'ESTIMATED'],
    ['BEF 1877', 'BEFORE'],
    ['AFT 1877', 'AFTER'],
  ] as const)('parses %s as %s', (input, qualifier) => {
    expect(parse(input).qualifier).toBe(qualifier);
  });

  it('distinguishes BETWEEN (one event) from FROM/TO (a state)', () => {
    const between = parse('BET 1877 AND 1880');
    const period = parse('FROM 1877 TO 1880');
    expect(between.qualifier).toBe('BETWEEN');
    expect(period.qualifier).toBe('RANGE');
    // Same window, different meaning. Merging them would make the Gantt lie.
    expect(between.interval).toEqual(period.interval);
  });

  it('leaves BEFORE open on the left and excludes the named year', () => {
    const d = parse('BEF 1877');
    expect(d.interval.earliest).toBeNull();
    expect(d.interval.latest).toBe(gregorianToJdn(1877, 1, 1) - 1);
  });

  it('leaves AFTER open on the right and excludes the named year', () => {
    const d = parse('AFT 1877');
    expect(d.interval.earliest).toBe(gregorianToJdn(1877, 12, 31) + 1);
    expect(d.interval.latest).toBeNull();
  });

  it('accepts an open-ended period', () => {
    const from = parse('FROM 1877');
    expect(from.interval.earliest).toBe(gregorianToJdn(1877, 1, 1));
    expect(from.interval.latest).toBeNull();

    const to = parse('TO 1880');
    expect(to.interval.earliest).toBeNull();
    expect(to.interval.latest).toBe(gregorianToJdn(1880, 12, 31));
  });

  it('honours the Julian calendar keyword and the 5.5.1 escape', () => {
    expect(parse('JULIAN 12 JUN 1877').calendar).toBe('JULIAN');
    expect(parse('@#DJULIAN@ 12 JUN 1877').calendar).toBe('JULIAN');
  });

  it('keeps a date phrase verbatim instead of inventing a position', () => {
    const d = parse('(vers la fin du règne)');
    expect(d.qualifier).toBe('UNKNOWN');
    expect(d.unparsed).toBe(true);
    expect(d.originalText).toBe('(vers la fin du règne)');
    expect(d.interval).toEqual({ earliest: null, latest: null });
  });
});

describe('French natural input', () => {
  it.each([
    ['12 juin 1877', 'EXACT'],
    ['vers 1877', 'ABOUT'],
    ['environ 1877', 'ABOUT'],
    ['avant 1880', 'BEFORE'],
    ['après 1880', 'AFTER'],
    ['entre 1877 et 1880', 'BETWEEN'],
    ['de 1877 à 1880', 'RANGE'],
  ] as const)('parses "%s" as %s', (input, qualifier) => {
    expect(parse(input).qualifier).toBe(qualifier);
  });

  it('is accent-insensitive', () => {
    expect(parse('12 fevrier 1877').start).toEqual({ year: 1877, month: 2, day: 12 });
    expect(parse('12 février 1877').start).toEqual({ year: 1877, month: 2, day: 12 });
  });

  it('reads numeric dates day-first, the French convention', () => {
    expect(parse('06/07/1877').start).toEqual({ year: 1877, month: 7, day: 6 });
  });

  it('resolves numeric ambiguity when the numbers allow it', () => {
    // 25 cannot be a month, so the order is settled regardless of convention.
    expect(parse('07/25/1877').start).toEqual({ year: 1877, month: 7, day: 25 });
  });

  it('reads ISO dates unambiguously', () => {
    expect(parse('1877-06-12').start).toEqual({ year: 1877, month: 6, day: 12 });
  });
});

describe('French Republican input', () => {
  it('parses "18 brumaire an VIII"', () => {
    const d = parse('18 brumaire an VIII');
    expect(d.calendar).toBe('FRENCH_R');
    expect(d.start).toEqual({ year: 8, month: 2, day: 18 });
    expect(d.interval.earliest).toBe(gregorianToJdn(1799, 11, 9));
  });

  it('parses the GEDCOM form "18 BRUM 8"', () => {
    const d = parse('FRENCH_R 18 BRUM 8');
    expect(d.calendar).toBe('FRENCH_R');
    expect(d.start).toEqual({ year: 8, month: 2, day: 18 });
  });

  it('infers the calendar from an unambiguous Republican month name', () => {
    // "thermidor" exists in no other calendar, so the calendar is implied.
    expect(parse('9 thermidor 2').calendar).toBe('FRENCH_R');
  });

  it('accepts an Arabic-numeral Republican year', () => {
    expect(parse('18 brumaire an 8').start).toEqual({ year: 8, month: 2, day: 18 });
  });
});

describe('unparseable input is preserved, never discarded', () => {
  it.each(['9br 1789', 'le jour de la Saint-Jean', 'circa the war', '????'])(
    'keeps %s',
    (input) => {
      const d = parse(input);
      expect(d.originalText).toBe(input);
      expect(d.unparsed).toBe(true);
    },
  );

  it('never throws, whatever the input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parseGenealogicalDate(s)).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });

  it('always preserves the trimmed original text', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(parseGenealogicalDate(s).originalText).toBe(s.trim());
      }),
      { numRuns: 1000 },
    );
  });
});

describe('GEDCOM round-trip', () => {
  const samples = [
    '12 JUN 1877',
    'JUN 1877',
    '1877',
    'ABT 1877',
    'CAL 12 JUN 1877',
    'EST 1877',
    'BEF 1877',
    'AFT 1877',
    'BET 1877 AND 1880',
    'FROM 1877 TO 1880',
    'FROM 1877',
    'TO 1880',
    'JULIAN 12 JUN 1877',
    'FRENCH_R 18 BRUM 8',
  ];

  it.each(samples)('%s survives parse -> serialise -> parse', (input) => {
    const once = parseGenealogicalDate(input);
    const serialised = toGedcomDateValue(once);
    const twice = parseGenealogicalDate(serialised);

    expect(twice.qualifier).toBe(once.qualifier);
    expect(twice.calendar).toBe(once.calendar);
    expect(twice.interval).toEqual(once.interval);
  });

  it('is idempotent under repeated serialisation', () => {
    for (const input of samples) {
      const a = toGedcomDateValue(parseGenealogicalDate(input));
      const b = toGedcomDateValue(parseGenealogicalDate(a));
      expect(b).toBe(a);
    }
  });

  it('round-trips arbitrary valid Gregorian dates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1500, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.constantFrom('EXACT', 'ABOUT', 'BEFORE', 'AFTER', 'ESTIMATED' as const),
        (year, month, day, qualifier) => {
          const original = makeDate({
            qualifier: qualifier as 'EXACT',
            start: { year, month, day },
            originalText: '',
          });
          const reparsed = parseGenealogicalDate(toGedcomDateValue(original));
          expect(reparsed.interval).toEqual(original.interval);
          expect(reparsed.start).toEqual(original.start);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe('display never overstates precision', () => {
  it.each([
    ['ABT 1877', 'vers 1877'],
    ['BEF 1877', 'avant 1877'],
    ['AFT 1877', 'après 1877'],
    ['BET 1877 AND 1880', 'entre 1877 et 1880'],
    ['FROM 1877 TO 1880', 'de 1877 à 1880'],
    ['12 JUN 1877', '12 juin 1877'],
    ['1 JUN 1877', '1er juin 1877'],
    ['JUN 1877', 'juin 1877'],
    ['1877', '1877'],
  ])('renders %s as "%s" in French', (input, expected) => {
    expect(formatGenealogicalDate(parse(input), { locale: 'fr' })).toBe(expected);
  });

  it('renders Republican dates in their own calendar', () => {
    expect(formatGenealogicalDate(parse('18 brumaire an VIII'))).toBe('18 brumaire an VIII');
  });

  it('marks uncertainty in the compact form used by the Gantt', () => {
    expect(formatYearOnly(parse('ABT 1877'))).toBe('~1877');
    expect(formatYearOnly(parse('BEF 1877'))).toBe('<1877');
    expect(formatYearOnly(parse('AFT 1877'))).toBe('>1877');
    expect(formatYearOnly(parse('BET 1877 AND 1880'))).toBe('1877–1880');
    expect(formatYearOnly(parse('nonsense'))).toBe('?');
  });

  it('shows the source wording when parsing failed', () => {
    expect(formatGenealogicalDate(parse('9br 1789'))).toBe('9br 1789');
  });
});
