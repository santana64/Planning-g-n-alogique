import { jdnToGregorian } from '@chronolignee/domain';

/**
 * A historical period in words: "14 juillet 1789" for a day, "1914 – 1918"
 * for years, "juin 1940" when it fits in a month — never more precise than
 * the catalogue's own dates.
 */

/** The part of next-intl's formatter this needs, with the options it uses. */
interface DateFormatter {
  dateTime(
    date: Date,
    options: {
      day?: 'numeric';
      month?: 'long' | 'short';
      year?: 'numeric';
      timeZone?: string;
    },
  ): string;
}

const toDate = (jdn: number) => {
  const { year, month, day } = jdnToGregorian(jdn);
  return new Date(Date.UTC(year, month - 1, day));
};

export function periodLabel(startJdn: number, endJdn: number, format: DateFormatter): string {
  const start = jdnToGregorian(startJdn);
  const end = jdnToGregorian(endJdn);
  const utc = { timeZone: 'UTC' } as const;
  if (startJdn === endJdn) {
    return format.dateTime(toDate(startJdn), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...utc,
    });
  }
  if (start.year === end.year && start.month === end.month) {
    return format.dateTime(toDate(startJdn), { month: 'long', year: 'numeric', ...utc });
  }
  // A whole year, or more: years only.
  const wholeYears = start.month === 1 && start.day === 1 && end.month === 12 && end.day === 31;
  if (wholeYears || end.year - start.year >= 2) {
    return start.year === end.year ? String(start.year) : `${start.year} – ${end.year}`;
  }
  const short = { day: 'numeric', month: 'short', year: 'numeric', ...utc } as const;
  return `${format.dateTime(toDate(startJdn), short)} – ${format.dateTime(toDate(endJdn), short)}`;
}
