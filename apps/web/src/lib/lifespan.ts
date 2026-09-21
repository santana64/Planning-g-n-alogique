import { jdnToGregorian } from '@chronolignee/domain';

/**
 * The years beside a name: "1834 – 1901", "1840 – ?", "sans date".
 *
 * Short enough to read in a list, and never invented. An inferred end — the
 * bound the engine derives for someone whose death is unrecorded — is not a
 * date anyone wrote down, so it shows as unknown rather than as a year.
 *
 * The conversion goes through the calendar. Dividing the Julian day number
 * by an average year length is off by one around New Year, and put a person
 * born on 1 January 1840 in 1839 on the duplicate review — the one screen
 * whose job is to tell two people apart by their dates.
 */
export interface LifespanBounds {
  readonly lifespanEarliestJdn: number | null;
  readonly lifespanLatestJdn: number | null;
  readonly lifespanLatestInferred: boolean;
}

export function lifespanYears(bounds: LifespanBounds): string {
  const { lifespanEarliestJdn: from, lifespanLatestJdn: to, lifespanLatestInferred } = bounds;
  const year = (jdn: number): number => jdnToGregorian(jdn).year;
  if (from === null && to === null) return 'sans date';
  if (from !== null && (to === null || lifespanLatestInferred)) return `${year(from)} – ?`;
  if (from === null && to !== null) return `? – ${year(to)}`;
  return `${year(from as number)} – ${year(to as number)}`;
}
