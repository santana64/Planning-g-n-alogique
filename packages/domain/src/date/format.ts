import type { Calendar, CalendarDateParts } from './calendar';
import { MONTH_TABLES } from './parse';
import type { GenealogicalDate } from './types';

/**
 * Date presentation.
 *
 * The governing rule is principle 12, no fake precision: a formatted date must
 * never look more certain than the record behind it. "ABT 1877" renders as
 * "vers 1877", never as "1877", and certainly never as "01/01/1877".
 */

export type DisplayLocale = 'fr' | 'en';

const FRENCH_MONTH_NAMES = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

const ENGLISH_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const REPUBLICAN_MONTH_NAMES = [
  'vendémiaire',
  'brumaire',
  'frimaire',
  'nivôse',
  'pluviôse',
  'ventôse',
  'germinal',
  'floréal',
  'prairial',
  'messidor',
  'thermidor',
  'fructidor',
  'jours complémentaires',
];

const ROMAN_THOUSANDS = ['', 'M', 'MM', 'MMM'];
const ROMAN_HUNDREDS = ['', 'C', 'CC', 'CCC', 'CD', 'D', 'DC', 'DCC', 'DCCC', 'CM'];
const ROMAN_TENS = ['', 'X', 'XX', 'XXX', 'XL', 'L', 'LX', 'LXX', 'LXXX', 'XC'];
const ROMAN_UNITS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

export function toRoman(value: number): string {
  if (value <= 0 || value >= 4000) return String(value);
  return (
    (ROMAN_THOUSANDS[Math.floor(value / 1000)] ?? '') +
    (ROMAN_HUNDREDS[Math.floor((value % 1000) / 100)] ?? '') +
    (ROMAN_TENS[Math.floor((value % 100) / 10)] ?? '') +
    (ROMAN_UNITS[value % 10] ?? '')
  );
}

function monthName(calendar: Calendar, month: number, locale: DisplayLocale): string {
  if (calendar === 'FRENCH_R') return REPUBLICAN_MONTH_NAMES[month - 1] ?? String(month);
  const table = locale === 'fr' ? FRENCH_MONTH_NAMES : ENGLISH_MONTH_NAMES;
  return table[month - 1] ?? String(month);
}

function formatYear(calendar: Calendar, year: number, locale: DisplayLocale): string {
  if (calendar === 'FRENCH_R') return `an ${toRoman(year)}`;
  if (year < 0) return `${Math.abs(year)} ${locale === 'fr' ? 'av. J.-C.' : 'BCE'}`;
  return String(year);
}

/** Render one set of calendar parts at whatever precision it actually has. */
export function formatParts(
  calendar: Calendar,
  parts: CalendarDateParts,
  locale: DisplayLocale,
): string {
  const year = formatYear(calendar, parts.year, locale);
  if (parts.month === undefined) return year;

  const month = monthName(calendar, parts.month, locale);
  if (parts.day === undefined) return `${month} ${year}`;

  // French writes "1er" for the first of the month; English uses the bare number.
  const day =
    locale === 'fr' && parts.day === 1 && calendar !== 'FRENCH_R' ? '1er' : String(parts.day);
  return `${day} ${month} ${year}`;
}

interface QualifierTemplates {
  readonly about: (d: string) => string;
  readonly calculated: (d: string) => string;
  readonly estimated: (d: string) => string;
  readonly before: (d: string) => string;
  readonly after: (d: string) => string;
  readonly between: (a: string, b: string) => string;
  readonly range: (a: string | null, b: string | null) => string;
  readonly unknown: string;
}

const TEMPLATES: Record<DisplayLocale, QualifierTemplates> = {
  fr: {
    about: (d) => `vers ${d}`,
    calculated: (d) => `${d} (calculé)`,
    estimated: (d) => `${d} (estimé)`,
    before: (d) => `avant ${d}`,
    after: (d) => `après ${d}`,
    between: (a, b) => `entre ${a} et ${b}`,
    range: (a, b) => (a && b ? `de ${a} à ${b}` : a ? `à partir de ${a}` : `jusqu'à ${b}`),
    unknown: 'date inconnue',
  },
  en: {
    about: (d) => `about ${d}`,
    calculated: (d) => `${d} (calculated)`,
    estimated: (d) => `${d} (estimated)`,
    before: (d) => `before ${d}`,
    after: (d) => `after ${d}`,
    between: (a, b) => `between ${a} and ${b}`,
    range: (a, b) => (a && b ? `from ${a} to ${b}` : a ? `from ${a}` : `until ${b}`),
    unknown: 'unknown date',
  },
};

export interface FormatDateOptions {
  readonly locale?: DisplayLocale;
  /**
   * When the parser failed, show the source wording rather than "unknown
   * date". The researcher can then see exactly what the register said.
   */
  readonly preferOriginalWhenUnparsed?: boolean;
}

export function formatGenealogicalDate(
  date: GenealogicalDate | null | undefined,
  options: FormatDateOptions = {},
): string {
  const locale = options.locale ?? 'fr';
  const t = TEMPLATES[locale];

  if (!date) return t.unknown;

  if (date.unparsed && (options.preferOriginalWhenUnparsed ?? true) && date.originalText) {
    return date.originalText;
  }

  const start = date.start ? formatParts(date.calendar, date.start, locale) : null;
  const end = date.end ? formatParts(date.calendar, date.end, locale) : null;

  switch (date.qualifier) {
    case 'EXACT':
      return start ?? t.unknown;
    case 'ABOUT':
      return start ? t.about(start) : t.unknown;
    case 'CALCULATED':
      return start ? t.calculated(start) : t.unknown;
    case 'ESTIMATED':
      return start ? t.estimated(start) : t.unknown;
    case 'BEFORE':
      return start ? t.before(start) : t.unknown;
    case 'AFTER':
      return start ? t.after(start) : t.unknown;
    case 'BETWEEN':
      return start && end ? t.between(start, end) : (start ?? end ?? t.unknown);
    case 'RANGE':
      return start || end ? t.range(start, end) : t.unknown;
    case 'UNKNOWN':
      return date.originalText || t.unknown;
  }
}

/**
 * Short form for dense surfaces: the year (or year range) only.
 * Used in the Gantt, lists and chips where a full date would not fit.
 */
export function formatYearOnly(
  date: GenealogicalDate | null | undefined,
  locale: DisplayLocale = 'fr',
): string {
  if (!date?.start && !date?.end) return '?';

  const startYear = date.start ? formatYear(date.calendar, date.start.year, locale) : null;
  const endYear = date.end ? formatYear(date.calendar, date.end.year, locale) : null;

  switch (date.qualifier) {
    case 'ABOUT':
    case 'ESTIMATED':
      return startYear ? `~${startYear}` : '?';
    case 'BEFORE':
      return startYear ? `<${startYear}` : '?';
    case 'AFTER':
      return startYear ? `>${startYear}` : '?';
    case 'BETWEEN':
    case 'RANGE':
      if (startYear && endYear) return `${startYear}–${endYear}`;
      return startYear ? `${startYear}–` : `–${endYear}`;
    default:
      return startYear ?? '?';
  }
}

// --- GEDCOM 7 serialisation -------------------------------------------------

const GEDCOM_MONTH_BY_NUMBER = Object.entries(MONTH_TABLES.gedcom).reduce<Record<number, string>>(
  (acc, [name, number]) => {
    if (acc[number] === undefined) acc[number] = name;
    return acc;
  },
  {},
);

const REPUBLICAN_MONTH_BY_NUMBER: Record<number, string> = {
  1: 'VEND',
  2: 'BRUM',
  3: 'FRIM',
  4: 'NIVO',
  5: 'PLUV',
  6: 'VENT',
  7: 'GERM',
  8: 'FLOR',
  9: 'PRAI',
  10: 'MESS',
  11: 'THER',
  12: 'FRUC',
  13: 'COMP',
};

const HEBREW_MONTH_BY_NUMBER: Record<number, string> = {
  1: 'TSH',
  2: 'CSH',
  3: 'KSL',
  4: 'TVT',
  5: 'SHV',
  6: 'ADR',
  7: 'ADS',
  8: 'NSN',
  9: 'IYR',
  10: 'SVN',
  11: 'TMZ',
  12: 'AAV',
  13: 'ELL',
};

function gedcomMonth(calendar: Calendar, month: number): string {
  if (calendar === 'FRENCH_R') return REPUBLICAN_MONTH_BY_NUMBER[month] ?? String(month);
  if (calendar === 'HEBREW') return HEBREW_MONTH_BY_NUMBER[month] ?? String(month);
  return GEDCOM_MONTH_BY_NUMBER[month] ?? String(month);
}

function gedcomParts(calendar: Calendar, parts: CalendarDateParts): string {
  const pieces: string[] = [];
  if (parts.day !== undefined) pieces.push(String(parts.day));
  if (parts.month !== undefined) pieces.push(gedcomMonth(calendar, parts.month));
  pieces.push(parts.year < 0 ? `${Math.abs(parts.year)} BCE` : String(parts.year));
  // GEDCOM 7 writes the calendar as a leading word; GREGORIAN is the default
  // and is conventionally omitted.
  const prefix = calendar === 'GREGORIAN' ? '' : `${calendar} `;
  return prefix + pieces.join(' ');
}

/**
 * Serialise to a GEDCOM 7 DateValue.
 *
 * An unparsed date round-trips as a date phrase in parentheses, which is
 * exactly what the specification provides for. Export therefore never loses
 * what import could not understand.
 */
export function toGedcomDateValue(date: GenealogicalDate | null | undefined): string {
  if (!date) return '';
  if (date.qualifier === 'UNKNOWN' || (date.unparsed && !date.start && !date.end)) {
    return date.originalText ? `(${date.originalText.replace(/[()]/g, '')})` : '';
  }

  const start = date.start ? gedcomParts(date.calendar, date.start) : null;
  const end = date.end ? gedcomParts(date.calendar, date.end) : null;

  switch (date.qualifier) {
    case 'EXACT':
      return start ?? '';
    case 'ABOUT':
      return start ? `ABT ${start}` : '';
    case 'CALCULATED':
      return start ? `CAL ${start}` : '';
    case 'ESTIMATED':
      return start ? `EST ${start}` : '';
    case 'BEFORE':
      return start ? `BEF ${start}` : '';
    case 'AFTER':
      return start ? `AFT ${start}` : '';
    case 'BETWEEN':
      return start && end ? `BET ${start} AND ${end}` : (start ?? '');
    case 'RANGE':
      if (start && end) return `FROM ${start} TO ${end}`;
      if (start) return `FROM ${start}`;
      return end ? `TO ${end}` : '';
    default:
      return '';
  }
}
