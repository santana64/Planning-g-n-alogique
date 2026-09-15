import type { Calendar, CalendarDateParts } from './calendar';

/**
 * How a source expressed a date. Mirrors the GEDCOM 7 DateValue grammar,
 * because that grammar encodes distinctions genealogists actually make.
 *
 * BETWEEN and RANGE are NOT the same thing and must never be merged:
 *   BETWEEN 1877 AND 1880 — one event happened at some unknown point inside
 *                           the window (a birth, a marriage)
 *   RANGE   1877 TO  1880 — a state held for the whole window (a residence,
 *                           an occupation, a military service)
 * Collapsing them would make the Gantt lie about what is known.
 */
export const DATE_QUALIFIERS = [
  'EXACT',
  'ABOUT',
  'CALCULATED',
  'ESTIMATED',
  'BEFORE',
  'AFTER',
  'BETWEEN',
  'RANGE',
  'UNKNOWN',
] as const;
export type DateQualifier = (typeof DATE_QUALIFIERS)[number];

export const DATE_PRECISIONS = ['DAY', 'MONTH', 'YEAR', 'DECADE', 'CENTURY', 'NONE'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/**
 * A closed-open-ended interval on the Julian Day Number axis.
 * `null` means unbounded on that side — genuinely unknown, not "year zero".
 */
export interface JdnInterval {
  readonly earliest: number | null;
  readonly latest: number | null;
}

/**
 * Three-valued answer. Two-valued logic cannot express genealogy honestly:
 * "was Jean alive in 1914?" has three defensible answers when his death is
 * recorded only as "after 1910".
 */
export const TRIVALENT = ['YES', 'MAYBE', 'NO'] as const;
export type Trivalent = (typeof TRIVALENT)[number];

/**
 * The canonical date value. Immutable; construct through `makeDate` or the
 * parser so the derived JDN bounds can never drift from the parts.
 */
export interface GenealogicalDate {
  readonly qualifier: DateQualifier;
  readonly calendar: Calendar;
  readonly precision: DatePrecision;
  /** Primary date parts. Absent for UNKNOWN and for open-ended "TO x" periods. */
  readonly start?: CalendarDateParts | undefined;
  /** Second bound, for BETWEEN and RANGE only. */
  readonly end?: CalendarDateParts | undefined;
  /**
   * Exactly what the source said, preserved verbatim. Never regenerated from
   * the parsed parts: if we misparse "9br 1789" the original must survive so a
   * human can correct us later.
   */
  readonly originalText: string;
  /** Resolved possible-window. Both null when the date carries no position. */
  readonly interval: JdnInterval;
  /**
   * Single representative point used for ordering lists. Midpoint of the
   * window when bounded. NEVER render this as if it were the date itself.
   */
  readonly sortJdn: number | null;
  /** True when the source text could not be understood. `originalText` still holds it. */
  readonly unparsed: boolean;
}

/**
 * How much slack an approximate date gets.
 *
 * These numbers are a product decision, not a fact: "about 1877" has no
 * objective width. They are collected here, injectable, and documented in
 * docs/TEMPORAL_MODEL.md rather than scattered as magic numbers.
 */
export interface EstimationPolicy {
  /** Half-width, in years, applied to ABOUT at year precision. */
  readonly aboutYearTolerance: number;
  /** Half-width, in years, for ESTIMATED — weaker evidence than ABOUT. */
  readonly estimatedYearTolerance: number;
  /** Half-width, in years, for CALCULATED — derived arithmetically, so tight. */
  readonly calculatedYearTolerance: number;
  /**
   * How far BEFORE/AFTER reach when otherwise unbounded, in years. Used only
   * for layout hints; the stored interval itself stays unbounded (null).
   */
  readonly openEndedLayoutYears: number;
}

export const DEFAULT_ESTIMATION_POLICY: EstimationPolicy = {
  aboutYearTolerance: 5,
  estimatedYearTolerance: 10,
  calculatedYearTolerance: 1,
  openEndedLayoutYears: 30,
};

/** Plausibility bounds used by validation. Outside these, a date is a typo. */
export const MIN_PLAUSIBLE_YEAR = -4000;
export const MAX_PLAUSIBLE_YEAR = 2200;

/** Longest human lifespan ever verified (Jeanne Calment, 122y164d), rounded up. */
export const MAX_PLAUSIBLE_LIFESPAN_YEARS = 123;
