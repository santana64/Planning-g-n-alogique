import {
  DAYS_PER_YEAR,
  daysInMonth,
  toJdn,
  wholeYearsBetween,
  type Calendar,
  type CalendarDateParts,
} from './calendar.js';
import {
  DEFAULT_ESTIMATION_POLICY,
  MAX_PLAUSIBLE_LIFESPAN_YEARS,
  type DatePrecision,
  type DateQualifier,
  type EstimationPolicy,
  type GenealogicalDate,
  type JdnInterval,
  type Trivalent,
} from './types.js';

export const UNBOUNDED: JdnInterval = { earliest: null, latest: null };

export function precisionOf(parts: CalendarDateParts | undefined): DatePrecision {
  if (!parts) return 'NONE';
  if (parts.day !== undefined && parts.month !== undefined) return 'DAY';
  if (parts.month !== undefined) return 'MONTH';
  return 'YEAR';
}

/**
 * The window a single set of calendar parts actually covers.
 * "June 1877" is not a point: it is the thirty days of that June.
 */
function partsToSpan(calendar: Calendar, parts: CalendarDateParts): JdnInterval {
  const { year, month, day } = parts;

  if (month !== undefined && day !== undefined) {
    const jdn = toJdn(calendar, { year, month, day });
    return { earliest: jdn, latest: jdn };
  }

  if (month !== undefined) {
    const first = toJdn(calendar, { year, month, day: 1 });
    const length = daysInMonth(calendar, year, month);
    if (first === null || length === null) return UNBOUNDED;
    return { earliest: first, latest: first + length - 1 };
  }

  const first = toJdn(calendar, { year, month: 1, day: 1 });
  const nextYear = toJdn(calendar, { year: year + 1, month: 1, day: 1 });
  if (first === null || nextYear === null) return UNBOUNDED;
  return { earliest: first, latest: nextYear - 1 };
}

function widenYears(span: JdnInterval, years: number): JdnInterval {
  const slack = Math.round(years * DAYS_PER_YEAR);
  return {
    earliest: span.earliest === null ? null : span.earliest - slack,
    latest: span.latest === null ? null : span.latest + slack,
  };
}

function toleranceFor(qualifier: DateQualifier, policy: EstimationPolicy): number {
  switch (qualifier) {
    case 'ABOUT':
      return policy.aboutYearTolerance;
    case 'ESTIMATED':
      return policy.estimatedYearTolerance;
    case 'CALCULATED':
      return policy.calculatedYearTolerance;
    default:
      return 0;
  }
}

export interface MakeDateInput {
  readonly qualifier: DateQualifier;
  readonly calendar?: Calendar;
  readonly start?: CalendarDateParts | undefined;
  readonly end?: CalendarDateParts | undefined;
  readonly originalText: string;
  readonly unparsed?: boolean;
}

/**
 * Build a canonical date, deriving its possible-window from the parts and the
 * qualifier. This is the only supported constructor: the interval and the
 * parts must never be able to disagree.
 */
export function makeDate(
  input: MakeDateInput,
  policy: EstimationPolicy = DEFAULT_ESTIMATION_POLICY,
): GenealogicalDate {
  const calendar = input.calendar ?? 'GREGORIAN';
  const { qualifier, start, end } = input;

  const startSpan = start ? partsToSpan(calendar, start) : UNBOUNDED;
  const endSpan = end ? partsToSpan(calendar, end) : UNBOUNDED;

  let interval: JdnInterval;

  switch (qualifier) {
    case 'EXACT':
      interval = startSpan;
      break;

    case 'ABOUT':
    case 'ESTIMATED':
    case 'CALCULATED':
      interval = widenYears(startSpan, toleranceFor(qualifier, policy));
      break;

    case 'BEFORE':
      // "BEF 1877" excludes 1877 itself: the day before the window opens.
      interval = {
        earliest: null,
        latest: startSpan.earliest === null ? null : startSpan.earliest - 1,
      };
      break;

    case 'AFTER':
      interval = {
        earliest: startSpan.latest === null ? null : startSpan.latest + 1,
        latest: null,
      };
      break;

    case 'BETWEEN':
    case 'RANGE':
      // "TO 1880" with no FROM stays open on the left.
      interval = start
        ? { earliest: startSpan.earliest, latest: end ? endSpan.latest : null }
        : { earliest: null, latest: endSpan.latest };
      break;

    case 'UNKNOWN':
      interval = UNBOUNDED;
      break;
  }

  return {
    qualifier,
    calendar,
    precision: precisionOf(start ?? end),
    start,
    end,
    originalText: input.originalText,
    interval,
    sortJdn: representativePoint(interval),
    unparsed: input.unparsed ?? false,
  };
}

export function unknownDate(originalText = ''): GenealogicalDate {
  return makeDate({ qualifier: 'UNKNOWN', originalText, unparsed: originalText.length > 0 });
}

/**
 * A single point standing in for the whole window, for list ordering only.
 * Midpoint when bounded on both sides, the known edge when half-bounded.
 */
export function representativePoint(interval: JdnInterval): number | null {
  const { earliest, latest } = interval;
  if (earliest !== null && latest !== null) return Math.floor((earliest + latest) / 2);
  if (earliest !== null) return earliest;
  if (latest !== null) return latest;
  return null;
}

export function isBounded(interval: JdnInterval): boolean {
  return interval.earliest !== null && interval.latest !== null;
}

/** Width of the possible-window in days, null when unbounded. */
export function intervalWidthDays(interval: JdnInterval): number | null {
  if (interval.earliest === null || interval.latest === null) return null;
  return interval.latest - interval.earliest;
}

/** True when the window is a single day, the only case we may render as exact. */
export function isPointInTime(interval: JdnInterval): boolean {
  return intervalWidthDays(interval) === 0;
}

// --- Three-valued temporal logic -------------------------------------------

/**
 * Does this date's event fall on the given day?
 *
 * A RANGE asserts a state held across its whole span, so a day inside it is a
 * definite YES. Every other qualifier describes a single moment somewhere in
 * the window, so anything wider than one day can only ever be MAYBE.
 */
export function dateContains(date: GenealogicalDate, jdn: number): Trivalent {
  const { earliest, latest } = date.interval;
  if (earliest !== null && jdn < earliest) return 'NO';
  if (latest !== null && jdn > latest) return 'NO';
  if (earliest === null && latest === null) return 'MAYBE';
  if (date.qualifier === 'RANGE' && isBounded(date.interval)) return 'YES';
  return isPointInTime(date.interval) ? 'YES' : 'MAYBE';
}

export function intervalsOverlap(a: JdnInterval, b: JdnInterval): Trivalent {
  // Disjoint for certain?
  if (a.latest !== null && b.earliest !== null && a.latest < b.earliest) return 'NO';
  if (b.latest !== null && a.earliest !== null && b.latest < a.earliest) return 'NO';

  // Overlapping for certain? Both windows must be fully known.
  if (isBounded(a) && isBounded(b)) return 'YES';

  return 'MAYBE';
}

/** Strictly-before comparison that stays honest about overlap. */
export function isBefore(a: JdnInterval, b: JdnInterval): Trivalent {
  if (a.latest !== null && b.earliest !== null && a.latest < b.earliest) return 'YES';
  if (a.earliest !== null && b.latest !== null && a.earliest > b.latest) return 'NO';
  return 'MAYBE';
}

/** Combine two answers, keeping the weaker (more honest) one. */
export function weakenTrivalent(a: Trivalent, b: Trivalent): Trivalent {
  if (a === 'NO' || b === 'NO') return 'NO';
  if (a === 'MAYBE' || b === 'MAYBE') return 'MAYBE';
  return 'YES';
}

// --- Lifespans --------------------------------------------------------------

export interface LifespanInput {
  readonly birth: GenealogicalDate | null | undefined;
  readonly death: GenealogicalDate | null | undefined;
  /** Explicit living/deceased status, when recorded. */
  readonly isDeceased?: boolean | undefined;
}

export interface ResolvedLifespan {
  readonly interval: JdnInterval;
  /** True when the upper bound came from the maximum-lifespan rule, not a source. */
  readonly latestIsInferred: boolean;
  /** True when neither birth nor death carries any temporal position. */
  readonly undated: boolean;
}

/**
 * Turn birth and death into one lifespan window.
 *
 * The load-bearing piece is the implied upper bound: a person whose birth is
 * recorded as 1750 and whose death is unrecorded was still not alive in 1950.
 * Without that rule "who was alive in 1945" returns every undated ancestor and
 * becomes useless. The bound is arithmetic, flagged as inferred, and never
 * written back to the person's death date.
 */
export function resolveLifespan(
  input: LifespanInput,
  todayJdn: number,
  maxLifespanYears: number = MAX_PLAUSIBLE_LIFESPAN_YEARS,
): ResolvedLifespan {
  const birth = input.birth?.interval ?? UNBOUNDED;
  const death = input.death?.interval ?? UNBOUNDED;

  const undated =
    birth.earliest === null &&
    birth.latest === null &&
    death.earliest === null &&
    death.latest === null;

  let latest = death.latest;
  let latestIsInferred = false;

  if (latest === null) {
    const maxDays = Math.round(maxLifespanYears * DAYS_PER_YEAR);
    const fromBirth = birth.earliest !== null ? birth.earliest + maxDays : null;
    // Someone recorded as living cannot already be dead, so today caps nothing
    // further back than today itself.
    const fromStatus = input.isDeceased === false ? todayJdn : null;

    const candidates = [fromBirth, fromStatus].filter((v): v is number => v !== null);
    if (candidates.length > 0) {
      latest = Math.min(...candidates);
      latestIsInferred = true;
    }
  }

  return {
    interval: { earliest: birth.earliest, latest },
    latestIsInferred,
    undated,
  };
}

/**
 * Was this person alive on the given day?
 *
 *   YES   - birth is certainly past and death is certainly not yet
 *   MAYBE - compatible with what is recorded, but uncertainty forbids a claim
 *   NO    - ruled out by the recorded dates
 */
export function wasAliveOn(
  input: LifespanInput,
  jdn: number,
  todayJdn: number,
  maxLifespanYears: number = MAX_PLAUSIBLE_LIFESPAN_YEARS,
): Trivalent {
  const birth = input.birth?.interval ?? UNBOUNDED;
  const death = input.death?.interval ?? UNBOUNDED;
  const resolved = resolveLifespan(input, todayJdn, maxLifespanYears);

  if (birth.earliest !== null && jdn < birth.earliest) return 'NO';
  if (resolved.interval.latest !== null && jdn > resolved.interval.latest) return 'NO';

  const bornForSure = birth.latest !== null && birth.latest <= jdn;
  const notYetDeadForSure =
    (death.earliest !== null && jdn <= death.earliest) ||
    (input.isDeceased === false && jdn <= todayJdn);

  return bornForSure && notYetDeadForSure ? 'YES' : 'MAYBE';
}

/**
 * Age in whole years on a given day, as a range when the birth date is
 * uncertain. Returns null when no birth position is known at all.
 */
export function ageAt(
  birth: GenealogicalDate | null | undefined,
  jdn: number,
): { min: number; max: number } | null {
  const b = birth?.interval;
  if (!b || (b.earliest === null && b.latest === null)) return null;

  // Calendar arithmetic, not a division by an average year length: an age a
  // user reads must match the one they would count on their fingers.
  const calendar = birth?.calendar ?? 'GREGORIAN';
  const upper = b.earliest !== null ? wholeYearsBetween(b.earliest, jdn, calendar) : null;
  const lower = b.latest !== null ? wholeYearsBetween(b.latest, jdn, calendar) : null;

  if (upper === null && lower === null) return null;
  if (upper === null) return { min: lower as number, max: lower as number };
  if (lower === null) return { min: upper, max: upper };
  return { min: lower, max: upper };
}
