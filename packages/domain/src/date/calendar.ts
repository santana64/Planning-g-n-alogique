/**
 * Calendar conversions, expressed through the Julian Day Number (JDN).
 *
 * Why JDN rather than a JS Date or a {year, month, day} tuple:
 *
 *  - It is a single integer that linearly orders every date across every
 *    supported calendar, across the Julian/Gregorian discontinuity, and
 *    before 1582 — where `new Date()` is silently wrong.
 *  - The temporal engine needs a numeric axis anyway. A JDN maps to an x
 *    coordinate with one multiplication, with no timezone or DST anywhere
 *    near the render loop.
 *  - Interval arithmetic ("was this person alive on that day?") becomes plain
 *    integer comparison.
 *
 * JS `Date` is used nowhere in the canonical model. It appears only at the
 * presentation edge, and even then only for calendars it actually handles.
 */

export const CALENDARS = ['GREGORIAN', 'JULIAN', 'FRENCH_R', 'HEBREW'] as const;
export type Calendar = (typeof CALENDARS)[number];

export interface CalendarDateParts {
  /** Astronomical year numbering: 1 BC is year 0, 2 BC is year -1. */
  readonly year: number;
  /** 1-12. Undefined when the source only gave a year. */
  readonly month?: number | undefined;
  /** 1-31. Undefined when the source gave no day. */
  readonly day?: number | undefined;
}

/** Integer division that floors toward negative infinity (JS `/` truncates). */
function idiv(a: number, b: number): number {
  return Math.floor(a / b);
}

// --- Gregorian (proleptic) --------------------------------------------------

export function gregorianToJdn(year: number, month: number, day: number): number {
  const a = idiv(14 - month, 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + idiv(153 * m + 2, 5) + 365 * y + idiv(y, 4) - idiv(y, 100) + idiv(y, 400) - 32045;
}

export function jdnToGregorian(jdn: number): Required<CalendarDateParts> {
  const a = jdn + 32044;
  const b = idiv(4 * a + 3, 146097);
  const c = a - idiv(146097 * b, 4);
  const d = idiv(4 * c + 3, 1461);
  const e = c - idiv(1461 * d, 4);
  const m = idiv(5 * e + 2, 153);
  return {
    day: e - idiv(153 * m + 2, 5) + 1,
    month: m + 3 - 12 * idiv(m, 10),
    year: 100 * b + d - 4800 + idiv(m, 10),
  };
}

// --- Julian -----------------------------------------------------------------

export function julianToJdn(year: number, month: number, day: number): number {
  const a = idiv(14 - month, 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + idiv(153 * m + 2, 5) + 365 * y + idiv(y, 4) - 32083;
}

export function jdnToJulian(jdn: number): Required<CalendarDateParts> {
  const c = jdn + 32082;
  const d = idiv(4 * c + 3, 1461);
  const e = c - idiv(1461 * d, 4);
  const m = idiv(5 * e + 2, 153);
  return {
    day: e - idiv(153 * m + 2, 5) + 1,
    month: m + 3 - 12 * idiv(m, 10),
    year: d - 4800 + idiv(m, 10),
  };
}

// --- French Republican ------------------------------------------------------

/**
 * JDN of 1 Vendemiaire an I = 22 September 1792 (Gregorian).
 *
 * Leap years follow the arithmetic Romme rule. For the calendar's actual
 * period of legal use (an I to an XIV, 1792-1805) the Romme rule reproduces
 * the historical sextile years III, VII and XI exactly, which is all French
 * civil registration ever needs. Dates far outside that window are accepted
 * arithmetically but carry no historical authority.
 */
const FRENCH_REPUBLICAN_EPOCH_JDN = 2_375_840;

/**
 * Sextile (leap) years are III, VII, XI, ... — NOT IV, VIII, XII.
 *
 * The Republican year opens at the autumn equinox and the complementary leap
 * day is appended at its END, so the year that *carries* the extra day is the
 * one before each Gregorian-style multiple of four. Getting this backwards
 * shifts every date after an III by one day, which is exactly what 18 Brumaire
 * an VIII exposes.
 */
function isFrenchRepublicanLeapYear(year: number): boolean {
  const n = year + 1;
  return n % 4 === 0 && (n % 100 !== 0 || n % 400 === 0);
}

function frenchRepublicanYearStartJdn(year: number): number {
  // Sextile years strictly before `year`: those y in [1, year-1] with
  // (y + 1) divisible by 4, minus the Romme century exceptions.
  const leaps = idiv(year, 4) - idiv(year, 100) + idiv(year, 400);
  return FRENCH_REPUBLICAN_EPOCH_JDN + (year - 1) * 365 + leaps;
}

export function frenchRepublicanToJdn(year: number, month: number, day: number): number {
  return frenchRepublicanYearStartJdn(year) + (month - 1) * 30 + (day - 1);
}

export function jdnToFrenchRepublican(jdn: number): Required<CalendarDateParts> {
  // Estimate then correct: the arithmetic year length is not constant.
  let year = Math.max(1, idiv(jdn - FRENCH_REPUBLICAN_EPOCH_JDN, 366) + 1);
  while (frenchRepublicanYearStartJdn(year + 1) <= jdn) year += 1;
  while (frenchRepublicanYearStartJdn(year) > jdn) year -= 1;

  const dayOfYear = jdn - frenchRepublicanYearStartJdn(year);
  return {
    year,
    month: idiv(dayOfYear, 30) + 1,
    day: (dayOfYear % 30) + 1,
  };
}

/** Days in a French Republican month: 30, except the 13th complementary "month". */
export function frenchRepublicanMonthLength(year: number, month: number): number {
  if (month === 13) return isFrenchRepublicanLeapYear(year) ? 6 : 5;
  return 30;
}

// --- Dispatch ---------------------------------------------------------------

export function daysInMonth(calendar: Calendar, year: number, month: number): number | null {
  switch (calendar) {
    case 'GREGORIAN':
      return new Date(Date.UTC(year, month, 0)).getUTCDate();
    case 'JULIAN': {
      const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (month < 1 || month > 12) return null;
      if (month === 2 && year % 4 === 0) return 29;
      return lengths[month - 1] ?? null;
    }
    case 'FRENCH_R':
      return frenchRepublicanMonthLength(year, month);
    case 'HEBREW':
      return null;
  }
}

/**
 * Convert calendar parts to a JDN.
 *
 * Returns `null` for calendars this version does not convert (Hebrew). That is
 * deliberate: a date we cannot place on the timeline must be stored, exported
 * and displayed from its original wording rather than given an invented
 * numeric position. Principle 12 — no fake precision.
 */
export function toJdn(calendar: Calendar, parts: CalendarDateParts): number | null {
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  switch (calendar) {
    case 'GREGORIAN':
      return gregorianToJdn(parts.year, month, day);
    case 'JULIAN':
      return julianToJdn(parts.year, month, day);
    case 'FRENCH_R':
      return frenchRepublicanToJdn(parts.year, month, day);
    case 'HEBREW':
      return null;
  }
}

export function fromJdn(calendar: Calendar, jdn: number): Required<CalendarDateParts> | null {
  switch (calendar) {
    case 'GREGORIAN':
      return jdnToGregorian(jdn);
    case 'JULIAN':
      return jdnToJulian(jdn);
    case 'FRENCH_R':
      return jdnToFrenchRepublican(jdn);
    case 'HEBREW':
      return null;
  }
}

/** JDN of 1 January 1970 — the bridge to JS `Date` at the presentation edge. */
export const JDN_UNIX_EPOCH = 2_440_588;

export function jdnToDate(jdn: number): Date {
  return new Date((jdn - JDN_UNIX_EPOCH) * 86_400_000);
}

export function dateToJdn(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000) + JDN_UNIX_EPOCH;
}

/** Average days per year. Only for widening approximate dates, never for ages. */
export const DAYS_PER_YEAR = 365.2425;

/**
 * Whole years between two days, counted the way a person counts a birthday.
 *
 * Dividing a day count by an average year length is wrong for anything a user
 * reads: 1 January 1700 to 1 January 1900 is 73 048 days, and 73 048 / 365.2425
 * floors to 199. Two centuries displayed as 199 years is the kind of small lie
 * this product exists to avoid, so ages are computed from calendar parts and
 * decremented when the anniversary has not yet come round.
 */
export function wholeYearsBetween(
  startJdn: number,
  endJdn: number,
  calendar: Calendar = 'GREGORIAN',
): number {
  // `|| 0` normalises negative zero. -0 formats as "0" but fails Object.is
  // against 0, which would make an equality check somewhere downstream behave
  // differently for a zero-length span depending on argument order.
  if (endJdn < startJdn) return -wholeYearsBetween(endJdn, startJdn, calendar) || 0;

  const from = fromJdn(calendar, startJdn);
  const to = fromJdn(calendar, endJdn);
  // Hebrew has no conversion, so fall back to the approximation there.
  if (!from || !to) return Math.floor((endJdn - startJdn) / DAYS_PER_YEAR);

  let years = to.year - from.year;
  const beforeAnniversary = to.month < from.month || (to.month === from.month && to.day < from.day);
  if (beforeAnniversary) years -= 1;
  return years;
}
