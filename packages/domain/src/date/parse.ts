import type { Calendar, CalendarDateParts } from './calendar.js';
import { makeDate, unknownDate } from './interval.js';
import {
  DEFAULT_ESTIMATION_POLICY,
  MAX_PLAUSIBLE_YEAR,
  MIN_PLAUSIBLE_YEAR,
  type DateQualifier,
  type EstimationPolicy,
  type GenealogicalDate,
} from './types.js';

/**
 * Genealogical date parser.
 *
 * Handles two input languages at once:
 *
 *  1. The GEDCOM 7 DateValue grammar, because that is what import files speak.
 *  2. Human French and English, because that is what a researcher types into a
 *     form while reading a parish register.
 *
 * It never throws and never discards. An input it cannot understand comes back
 * as an UNKNOWN date that still carries `originalText` verbatim, so a later
 * human (or a better parser version) can recover it. Silently dropping a date
 * because we failed to read it would be data loss disguised as robustness.
 */

// --- Month vocabulary -------------------------------------------------------

const GEDCOM_MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const FRENCH_MONTHS: Record<string, number> = {
  JANVIER: 1,
  JANV: 1,
  FEVRIER: 2,
  FEVR: 2,
  FEV: 2,
  MARS: 3,
  AVRIL: 4,
  AVR: 4,
  MAI: 5,
  JUIN: 6,
  JUILLET: 7,
  JUIL: 7,
  AOUT: 8,
  SEPTEMBRE: 9,
  SEPT: 9,
  OCTOBRE: 10,
  OCT: 10,
  NOVEMBRE: 11,
  NOV: 11,
  DECEMBRE: 12,
  DEC: 12,
};

const ENGLISH_MONTHS: Record<string, number> = {
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
};

/**
 * French Republican months. Essential for French civil registration between
 * 1792 and 1806: an act from "3 Frimaire an XII" is not an oddity, it is the
 * only form that exists for those fourteen years.
 */
const FRENCH_REPUBLICAN_MONTHS: Record<string, number> = {
  VEND: 1,
  VENDEMIAIRE: 1,
  BRUM: 2,
  BRUMAIRE: 2,
  FRIM: 3,
  FRIMAIRE: 3,
  NIVO: 4,
  NIVOSE: 4,
  PLUV: 5,
  PLUVIOSE: 5,
  VENT: 6,
  VENTOSE: 6,
  GERM: 7,
  GERMINAL: 7,
  FLOR: 8,
  FLOREAL: 8,
  PRAI: 9,
  PRAIRIAL: 9,
  MESS: 10,
  MESSIDOR: 10,
  THER: 11,
  THERMIDOR: 11,
  FRUC: 12,
  FRUCTIDOR: 12,
  COMP: 13,
  COMPLEMENTAIRES: 13,
  SANSCULOTTIDES: 13,
};

const HEBREW_MONTHS: Record<string, number> = {
  TSH: 1,
  CSH: 2,
  KSL: 3,
  TVT: 4,
  SHV: 5,
  ADR: 6,
  ADS: 7,
  NSN: 8,
  IYR: 9,
  SVN: 10,
  TMZ: 11,
  AAV: 12,
  ELL: 13,
};

const CALENDAR_KEYWORDS: Record<string, Calendar> = {
  GREGORIAN: 'GREGORIAN',
  JULIAN: 'JULIAN',
  FRENCH_R: 'FRENCH_R',
  'FRENCH R': 'FRENCH_R',
  HEBREW: 'HEBREW',
};

/** Roman numerals, for French Republican years written "an XII". */
const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

function parseRoman(token: string): number | null {
  if (!/^[IVXLCDM]+$/.test(token)) return null;
  let total = 0;
  let previous = 0;
  for (let i = token.length - 1; i >= 0; i -= 1) {
    const value = ROMAN_VALUES[token[i] as string];
    if (value === undefined) return null;
    total += value < previous ? -value : value;
    if (value >= previous) previous = value;
  }
  return total > 0 && total < 4000 ? total : null;
}

// --- Normalisation ----------------------------------------------------------

/**
 * Fold to uppercase ASCII for keyword matching. "Février" and "FEVRIER" must
 * hit the same table entry, and researchers type both.
 */
function normalise(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function monthFromToken(token: string, calendar: Calendar): number | null {
  if (calendar === 'FRENCH_R') return FRENCH_REPUBLICAN_MONTHS[token] ?? null;
  if (calendar === 'HEBREW') return HEBREW_MONTHS[token] ?? null;
  return (
    GEDCOM_MONTHS[token] ??
    FRENCH_MONTHS[token] ??
    ENGLISH_MONTHS[token] ??
    FRENCH_REPUBLICAN_MONTHS[token] ??
    null
  );
}

/** A bare month token that only exists in the Republican calendar implies it. */
function impliesFrenchRepublican(token: string): boolean {
  return (
    FRENCH_REPUBLICAN_MONTHS[token] !== undefined &&
    GEDCOM_MONTHS[token] === undefined &&
    FRENCH_MONTHS[token] === undefined &&
    ENGLISH_MONTHS[token] === undefined
  );
}

// --- Qualifier keywords -----------------------------------------------------

interface QualifierMatch {
  readonly qualifier: DateQualifier;
  readonly rest: string;
  readonly separator?: string;
}

const PREFIXES: ReadonlyArray<{
  words: readonly string[];
  qualifier: DateQualifier;
  separator?: string;
}> = [
  { words: ['BET', 'BETWEEN', 'ENTRE'], qualifier: 'BETWEEN', separator: 'AND|ET|-' },
  {
    words: ['FROM', 'DE', 'DU', 'DEPUIS'],
    qualifier: 'RANGE',
    separator: 'TO|A|AU|JUSQU A|JUSQU AU',
  },
  { words: ['BEF', 'BEFORE', 'AVANT'], qualifier: 'BEFORE' },
  { words: ['AFT', 'AFTER', 'APRES'], qualifier: 'AFTER' },
  { words: ['ABT', 'ABOUT', 'CIRCA', 'CA', 'VERS', 'ENVIRON', 'V'], qualifier: 'ABOUT' },
  { words: ['CAL', 'CALCULATED', 'CALCULE'], qualifier: 'CALCULATED' },
  { words: ['EST', 'ESTIMATED', 'ESTIME'], qualifier: 'ESTIMATED' },
  { words: ['TO', 'JUSQU A', 'JUSQU AU'], qualifier: 'RANGE' },
];

function matchQualifier(text: string): QualifierMatch | null {
  for (const entry of PREFIXES) {
    for (const word of entry.words) {
      if (text === word) continue;
      if (text.startsWith(`${word} `)) {
        const match: QualifierMatch = {
          qualifier: entry.qualifier,
          rest: text.slice(word.length + 1).trim(),
        };
        return entry.separator ? { ...match, separator: entry.separator } : match;
      }
    }
  }
  return null;
}

// --- Single-date parsing ----------------------------------------------------

interface ParsedParts {
  readonly parts: CalendarDateParts;
  readonly calendar: Calendar;
}

function plausibleYear(year: number, calendar: Calendar): boolean {
  // Republican years are counted from 1792 and never exceeded XIV in practice,
  // but the arithmetic stays valid well beyond, so only reject nonsense.
  if (calendar === 'FRENCH_R') return year >= 1 && year <= 400;
  return year >= MIN_PLAUSIBLE_YEAR && year <= MAX_PLAUSIBLE_YEAR;
}

/**
 * Parse one date (no qualifier). Returns null when the text is not a date.
 */
function parseSingleDate(
  raw: string,
  fallbackCalendar: Calendar,
  dayFirst: boolean,
): ParsedParts | null {
  let text = raw.trim();
  if (!text) return null;

  let calendar = fallbackCalendar;

  // GEDCOM 5.5.1 calendar escape: @#DJULIAN@
  const escape = /^@#D([A-Z_ ]+)@\s*/.exec(text);
  if (escape?.[1]) {
    const found = CALENDAR_KEYWORDS[escape[1].trim()];
    if (found) calendar = found;
    text = text.slice(escape[0].length).trim();
  } else {
    // GEDCOM 7 leading calendar word: JULIAN 12 JUN 1877
    for (const [keyword, value] of Object.entries(CALENDAR_KEYWORDS)) {
      if (text.startsWith(`${keyword} `)) {
        calendar = value;
        text = text.slice(keyword.length + 1).trim();
        break;
      }
    }
  }

  // Epoch marker. GEDCOM 7 uses BCE, 5.5.1 used B.C. (already de-dotted).
  let bce = false;
  const epoch = /\s+(BCE|BC|B C|AV J C|AVJC)$/.exec(text);
  if (epoch) {
    bce = true;
    text = text.slice(0, epoch.index).trim();
  }

  // "an XII" / "AN 12" — French Republican year marker.
  const republicanYear = /^(?:(\d{1,2}|[A-Z]+)\s+)?([A-Z]+)\s+AN\s+([IVXLCDM]+|\d{1,3})$/.exec(
    text,
  );
  if (republicanYear) {
    const [, dayToken, monthToken, yearToken] = republicanYear;
    const month = monthToken ? FRENCH_REPUBLICAN_MONTHS[monthToken] : undefined;
    const year = yearToken ? (parseRoman(yearToken) ?? Number.parseInt(yearToken, 10)) : Number.NaN;
    if (month !== undefined && Number.isFinite(year)) {
      const day = dayToken ? Number.parseInt(dayToken, 10) : undefined;
      return {
        calendar: 'FRENCH_R',
        parts: {
          year,
          month,
          ...(day !== undefined && Number.isFinite(day) ? { day } : {}),
        },
      };
    }
  }

  // Bare "AN XII"
  const bareRepublicanYear = /^AN\s+([IVXLCDM]+|\d{1,3})$/.exec(text);
  if (bareRepublicanYear?.[1]) {
    const year = parseRoman(bareRepublicanYear[1]) ?? Number.parseInt(bareRepublicanYear[1], 10);
    if (Number.isFinite(year)) return { calendar: 'FRENCH_R', parts: { year } };
  }

  // Numeric forms: 12/06/1877, 12-06-1877, 1877-06-12
  const isoNumeric = /^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/.exec(text);
  if (isoNumeric?.[1] && isoNumeric[2]) {
    const year = Number.parseInt(isoNumeric[1], 10);
    const month = Number.parseInt(isoNumeric[2], 10);
    const day = isoNumeric[3] ? Number.parseInt(isoNumeric[3], 10) : undefined;
    if (month >= 1 && month <= 12 && plausibleYear(year, calendar)) {
      return { calendar, parts: { year, month, ...(day ? { day } : {}) } };
    }
  }

  const slashNumeric = /^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/.exec(text);
  if (slashNumeric?.[1] && slashNumeric[2] && slashNumeric[3]) {
    const a = Number.parseInt(slashNumeric[1], 10);
    const b = Number.parseInt(slashNumeric[2], 10);
    const year = Number.parseInt(slashNumeric[3], 10);
    // Day/month order is genuinely ambiguous. Default to day-first (French
    // convention, the product default locale) unless the numbers settle it.
    let day = dayFirst ? a : b;
    let month = dayFirst ? b : a;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      day = b;
      month = a;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && plausibleYear(year, calendar)) {
      return { calendar, parts: { year, month, day } };
    }
  }

  // Word forms: 12 JUN 1877 / 12 juin 1877 / JUN 1877 / 1877
  const tokens = text.split(' ').filter(Boolean);

  if (tokens.length === 1 && tokens[0] && /^\d{1,4}$/.test(tokens[0])) {
    const year = Number.parseInt(tokens[0], 10) * (bce ? -1 : 1);
    return plausibleYear(year, calendar) ? { calendar, parts: { year } } : null;
  }

  if (tokens.length === 2 && tokens[0] && tokens[1]) {
    if (impliesFrenchRepublican(tokens[0])) calendar = 'FRENCH_R';
    const month = monthFromToken(tokens[0], calendar);
    const year = Number.parseInt(tokens[1], 10);
    if (month !== null && Number.isFinite(year) && plausibleYear(year, calendar)) {
      return { calendar, parts: { year: bce ? -year : year, month } };
    }
  }

  if (tokens.length === 3 && tokens[0] && tokens[1] && tokens[2]) {
    if (impliesFrenchRepublican(tokens[1])) calendar = 'FRENCH_R';
    const day = Number.parseInt(tokens[0], 10);
    const month = monthFromToken(tokens[1], calendar);
    const year = Number.parseInt(tokens[2], 10);
    if (
      Number.isFinite(day) &&
      day >= 1 &&
      day <= 31 &&
      month !== null &&
      Number.isFinite(year) &&
      plausibleYear(year, calendar)
    ) {
      return { calendar, parts: { year: bce ? -year : year, month, day } };
    }
  }

  return null;
}

// --- Public API -------------------------------------------------------------

export interface ParseDateOptions {
  /** Calendar to assume when the text does not name one. */
  readonly calendar?: Calendar;
  /** Numeric d/m/y ordering. True (French convention) by default. */
  readonly dayFirst?: boolean;
  readonly policy?: EstimationPolicy;
}

/**
 * Parse a genealogical date from GEDCOM or human text.
 * Always succeeds; failure is represented as an UNKNOWN date that retains the
 * original wording and is flagged `unparsed`.
 */
export function parseGenealogicalDate(
  input: string,
  options: ParseDateOptions = {},
): GenealogicalDate {
  const originalText = input.trim();
  const policy = options.policy ?? DEFAULT_ESTIMATION_POLICY;
  const fallbackCalendar = options.calendar ?? 'GREGORIAN';
  const dayFirst = options.dayFirst ?? true;

  if (!originalText) return unknownDate('');

  // A GEDCOM date phrase is free text in parentheses. It is not parseable by
  // design; the specification says to keep it as written.
  if (originalText.startsWith('(') && originalText.endsWith(')')) {
    return makeDate({ qualifier: 'UNKNOWN', originalText, unparsed: true }, policy);
  }

  const text = normalise(originalText);
  const matched = matchQualifier(text);

  if (matched) {
    const { qualifier, rest, separator } = matched;

    if (separator) {
      const splitter = new RegExp(`\\s+(?:${separator})\\s+`, 'i');
      const halves = rest.split(splitter);
      const [left, right] = halves;

      if (halves.length === 2 && left && right) {
        const a = parseSingleDate(left, fallbackCalendar, dayFirst);
        const b = parseSingleDate(right, fallbackCalendar, dayFirst);
        if (a && b) {
          return makeDate(
            {
              qualifier,
              calendar: a.calendar,
              start: a.parts,
              end: b.parts,
              originalText,
            },
            policy,
          );
        }
      }

      // "FROM 1877" with no upper bound is a legitimate open-ended period.
      if (halves.length === 1 && left) {
        const a = parseSingleDate(left, fallbackCalendar, dayFirst);
        if (a) {
          return makeDate(
            { qualifier, calendar: a.calendar, start: a.parts, originalText },
            policy,
          );
        }
      }

      return makeDate({ qualifier: 'UNKNOWN', originalText, unparsed: true }, policy);
    }

    const single = parseSingleDate(rest, fallbackCalendar, dayFirst);
    if (single) {
      // A bare "TO 1880" is a period open on the left, not a point.
      const isOpenLeftPeriod = qualifier === 'RANGE';
      return makeDate(
        isOpenLeftPeriod
          ? { qualifier, calendar: single.calendar, end: single.parts, originalText }
          : { qualifier, calendar: single.calendar, start: single.parts, originalText },
        policy,
      );
    }
    return makeDate({ qualifier: 'UNKNOWN', originalText, unparsed: true }, policy);
  }

  const single = parseSingleDate(text, fallbackCalendar, dayFirst);
  if (single) {
    return makeDate(
      { qualifier: 'EXACT', calendar: single.calendar, start: single.parts, originalText },
      policy,
    );
  }

  return makeDate({ qualifier: 'UNKNOWN', originalText, unparsed: true }, policy);
}

/** Month tables, exported for the formatter and the GEDCOM writer. */
export const MONTH_TABLES = {
  gedcom: GEDCOM_MONTHS,
  french: FRENCH_MONTHS,
  english: ENGLISH_MONTHS,
  frenchRepublican: FRENCH_REPUBLICAN_MONTHS,
  hebrew: HEBREW_MONTHS,
} as const;
