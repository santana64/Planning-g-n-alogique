import {
  makeDate,
  unknownDate,
  type Calendar,
  type CalendarDateParts,
  type DatePrecision,
  type DateQualifier,
  type GenealogicalDate,
} from '@chronolignee/domain';

/**
 * Codec between the domain's GenealogicalDate and the flat columns that store
 * it.
 *
 * There are two representations because each is right for a different job: the
 * domain object is right for reasoning, and flat integer columns are right for
 * `WHERE earliest <= :d AND latest >= :d` over 20 000 rows. The danger is that
 * they drift — that someone updates `dateStartYear` and leaves
 * `dateEarliestJdn` describing the old value, after which every temporal query
 * quietly returns the wrong people.
 *
 * This codec is the only sanctioned way to cross that boundary. Encoding always
 * recomputes the window from the parts, so a drifted pair cannot be written.
 */

/** The flat column set, named to match the Prisma models. */
export interface EncodedDate {
  dateQualifier: DateQualifier;
  dateCalendar: Calendar;
  datePrecision: DatePrecision;
  dateStartYear: number | null;
  dateStartMonth: number | null;
  dateStartDay: number | null;
  dateEndYear: number | null;
  dateEndMonth: number | null;
  dateEndDay: number | null;
  dateOriginalText: string;
  dateUnparsed: boolean;
  dateEarliestJdn: number | null;
  dateLatestJdn: number | null;
  dateSortJdn: number | null;
}

/**
 * Flatten a domain date into columns.
 *
 * The JDN window is taken from the date object, which derived it from the
 * parts when it was constructed. Callers cannot supply their own window.
 */
export function encodeDate(date: GenealogicalDate | null | undefined): EncodedDate {
  const d = date ?? unknownDate();
  return {
    dateQualifier: d.qualifier,
    dateCalendar: d.calendar,
    datePrecision: d.precision,
    dateStartYear: d.start?.year ?? null,
    dateStartMonth: d.start?.month ?? null,
    dateStartDay: d.start?.day ?? null,
    dateEndYear: d.end?.year ?? null,
    dateEndMonth: d.end?.month ?? null,
    dateEndDay: d.end?.day ?? null,
    dateOriginalText: d.originalText,
    dateUnparsed: d.unparsed,
    dateEarliestJdn: d.interval.earliest,
    dateLatestJdn: d.interval.latest,
    dateSortJdn: d.sortJdn,
  };
}

function partsFrom(
  year: number | null,
  month: number | null,
  day: number | null,
): CalendarDateParts | undefined {
  if (year === null) return undefined;
  return {
    year,
    ...(month !== null ? { month } : {}),
    ...(day !== null ? { day } : {}),
  };
}

/**
 * Rebuild a domain date from columns.
 *
 * The stored JDN window is deliberately ignored and recomputed from the parts.
 * If a row was written before a fix to the interval rules (the French
 * Republican leap-year correction, for instance), reading it produces the
 * corrected window rather than perpetuating the old one.
 */
export function decodeDate(row: Partial<EncodedDate> | null | undefined): GenealogicalDate {
  if (!row || !row.dateQualifier) return unknownDate();

  const start = partsFrom(
    row.dateStartYear ?? null,
    row.dateStartMonth ?? null,
    row.dateStartDay ?? null,
  );
  const end = partsFrom(row.dateEndYear ?? null, row.dateEndMonth ?? null, row.dateEndDay ?? null);

  return makeDate({
    qualifier: row.dateQualifier,
    calendar: row.dateCalendar ?? 'GREGORIAN',
    start,
    end,
    originalText: row.dateOriginalText ?? '',
    unparsed: row.dateUnparsed ?? false,
  });
}

/**
 * Encode with a column prefix, for models that store a date under a different
 * name (Media stores a capture window, not an event date).
 */
export function encodeDateWindow(date: GenealogicalDate | null | undefined): {
  earliestJdn: number | null;
  latestJdn: number | null;
  originalText: string;
} {
  const d = date ?? unknownDate();
  return {
    earliestJdn: d.interval.earliest,
    latestJdn: d.interval.latest,
    originalText: d.originalText,
  };
}
