import { jdnToGregorian } from '@chronolignee/domain';

/**
 * The pedigree as a fan whose radius is time.
 *
 * A classic fan chart puts each generation on its own ring, which quietly
 * asserts that every generation lasts the same. It does not: a line of eldest
 * sons can move thirty years a generation while a line of late second
 * marriages moves forty-five, and a pedigree collapse can fold two branches
 * into the same decade. Here the rings are calendar years. A branch that
 * reaches further out per step is a branch of longer generations; two
 * ancestors at the same radius were born in the same years.
 *
 * Each ancestor is a band, not a line, and the band's thickness is how much of
 * their birth the records pin down. An exact date is a hairline; "vers 1750"
 * is a wide band; "avant 1750" has no outer edge at all. An ancestor with no
 * birth date is not placed anywhere — putting them on a ring would invent the
 * one thing this chart exists to show.
 */

export interface FanAncestor {
  readonly personId: string;
  /** One Sosa position. A collapsed ancestor is passed once per position. */
  readonly sosa: number;
  readonly birthEarliestJdn: number | null;
  readonly birthLatestJdn: number | null;
}

export interface FanSector {
  readonly personId: string;
  readonly sosa: number;
  readonly generation: number;
  /** Position around the fan, as a fraction of its sweep: 0 is the paternal edge. */
  readonly startFraction: number;
  readonly endFraction: number;
  /**
   * Distance from the centre in years before the reference. Inner is the
   * latest the birth could have been, outer the earliest.
   */
  readonly innerYears: number;
  readonly outerYears: number;
  /** "après 1750": no latest bound, so the band has no inner edge. */
  readonly innerOpen: boolean;
  /** "avant 1750": no earliest bound, so the band has no outer edge. */
  readonly outerOpen: boolean;
  /** Wider than a year: the records give a range, not a date. */
  readonly uncertain: boolean;
  /**
   * Born after the person at the centre, which no ancestor can be. Drawn, and
   * flagged, rather than clamped out of sight — it is a data error someone
   * needs to find.
   */
  readonly anomalous: boolean;
}

export interface FanRing {
  /** A round calendar year. */
  readonly year: number;
  readonly offsetYears: number;
}

export interface TemporalFanLayout {
  readonly sectors: readonly FanSector[];
  /** Ancestors in the pedigree whose birth is not dated at all. */
  readonly unplaced: readonly { readonly personId: string; readonly sosa: number }[];
  /** The calendar year at the centre, or null when the subject is undated. */
  readonly referenceYear: number | null;
  /** The outermost extent in years, for the scale. */
  readonly maxYears: number;
  readonly rings: readonly FanRing[];
}

const DAYS_PER_YEAR = 365.2425;

/** Ring spacing that keeps the guides readable at any depth. */
function ringStep(maxYears: number): number {
  if (maxYears <= 60) return 10;
  if (maxYears <= 150) return 25;
  if (maxYears <= 300) return 50;
  return 100;
}

export function layoutTemporalFan(
  subject: { readonly birthEarliestJdn: number | null; readonly birthLatestJdn: number | null },
  ancestors: readonly FanAncestor[],
): TemporalFanLayout {
  const { birthEarliestJdn: subjectEarliest, birthLatestJdn: subjectLatest } = subject;

  // The centre is the subject's birth. Without it there is no "before" to
  // measure from, and a temporal fan would be a generational one pretending.
  const referenceJdn =
    subjectEarliest !== null && subjectLatest !== null
      ? (subjectEarliest + subjectLatest) / 2
      : (subjectEarliest ?? subjectLatest);

  if (referenceJdn === null) {
    return {
      sectors: [],
      unplaced: ancestors.map(({ personId, sosa }) => ({ personId, sosa })),
      referenceYear: null,
      maxYears: 0,
      rings: [],
    };
  }

  const sectors: FanSector[] = [];
  const unplaced: { personId: string; sosa: number }[] = [];
  let maxYears = 0;

  for (const ancestor of ancestors) {
    if (ancestor.sosa < 2 || !Number.isInteger(ancestor.sosa)) continue;
    const { birthEarliestJdn: earliest, birthLatestJdn: latest } = ancestor;
    if (earliest === null && latest === null) {
      unplaced.push({ personId: ancestor.personId, sosa: ancestor.sosa });
      continue;
    }

    const generation = Math.floor(Math.log2(ancestor.sosa));
    const slots = 2 ** generation;
    const index = ancestor.sosa - slots;

    // An open end borrows the closed one, so the band at least starts where
    // the records put it; the open flag tells the renderer not to draw an
    // edge there.
    const innerYears = (referenceJdn - (latest ?? earliest ?? referenceJdn)) / DAYS_PER_YEAR;
    const outerYears = (referenceJdn - (earliest ?? latest ?? referenceJdn)) / DAYS_PER_YEAR;

    sectors.push({
      personId: ancestor.personId,
      sosa: ancestor.sosa,
      generation,
      startFraction: index / slots,
      endFraction: (index + 1) / slots,
      innerYears,
      outerYears,
      innerOpen: latest === null,
      outerOpen: earliest === null,
      uncertain: outerYears - innerYears > 1,
      anomalous: innerYears < 0,
    });
    maxYears = Math.max(maxYears, outerYears);
  }

  const referenceYear = jdnToGregorian(Math.round(referenceJdn)).year;
  const step = ringStep(maxYears);
  const rings: FanRing[] = [];
  // Round calendar years, walking back from the first multiple of the step at
  // or before the centre. "1800" on a ring means 1800, not "about 22 years".
  for (let year = Math.floor(referenceYear / step) * step; ; year -= step) {
    const offsetYears = referenceYear - year;
    if (offsetYears > maxYears + step) break;
    if (offsetYears > 0) rings.push({ year, offsetYears });
    if (rings.length > 40) break;
  }

  return {
    sectors: sectors.sort((a, b) => a.sosa - b.sosa),
    unplaced: unplaced.sort((a, b) => a.sosa - b.sosa),
    referenceYear,
    maxYears,
    rings,
  };
}
