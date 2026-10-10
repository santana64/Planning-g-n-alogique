/**
 * What to look for next about one person, and where — by rules.
 *
 * The rules are the ones a French genealogist learns in their first year,
 * written down so that every record gets them:
 *
 *  - before the civil registers (decree of 20 September 1792) births,
 *    marriages and burials are in the parish registers ("BMS"); after, in
 *    the état civil, with ten-year indexes (tables décennales) from 1793;
 *  - a marriage act names the parents of both spouses — the usual way to
 *    find a generation further up;
 *  - nominative censuses exist every five years from 1836 to 1936 (1872
 *    instead of 1871, none in 1916);
 *  - men born from about 1847 have a military register entry (registres
 *    matricules) in the class of the year they turned twenty;
 *  - a death leaves a declaration of succession at the registration office;
 *  - since 1945 a death is noted in the margin of the birth act.
 *
 * Each step says what is missing and where it is usually found. None says
 * what the answer is: the plan is a list of questions, and every one of them
 * rests on something the record does or does not hold.
 */

export interface PlanEvent {
  readonly year: number | null;
  /** True when the year is a window (about, before, between). */
  readonly approximate: boolean;
  readonly place: string | null;
  readonly sourced: boolean;
}

export interface PlanSubject {
  readonly sex: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
  readonly isLiving: boolean;
  readonly birth: PlanEvent | null;
  readonly baptism: PlanEvent | null;
  readonly death: PlanEvent | null;
  readonly burial: PlanEvent | null;
  readonly marriages: ReadonlyArray<PlanEvent & { readonly spouse: string | null }>;
  readonly parentsKnown: number;
  readonly childrenKnown: number;
  /** Places the person is recorded at, latest last, with the years known. */
  readonly places: ReadonlyArray<{ readonly place: string; readonly year: number | null }>;
}

export type PlanStepKind =
  | 'PARENTS_FROM_MARRIAGE'
  | 'PARENTS_FROM_BIRTH'
  | 'BIRTH_PARISH'
  | 'BIRTH_CIVIL'
  | 'BIRTH_SOURCE'
  | 'MARRIAGE_FIND'
  | 'MARRIAGE_SOURCE'
  | 'DEATH_FIND'
  | 'DEATH_MARGIN'
  | 'DEATH_SOURCE'
  | 'CENSUS'
  | 'MILITARY'
  | 'SUCCESSION';

export interface PlanStep {
  /** Stable for a given record, so the same gap is not offered twice. */
  readonly id: string;
  readonly kind: PlanStepKind;
  readonly priority: 'HIGH' | 'NORMAL' | 'LOW';
  /** Values for the sentence: place, years, a census list, a class. */
  readonly params: Readonly<Record<string, string | number>>;
  /** Suggested search window, in years. */
  readonly from: number | null;
  readonly to: number | null;
}

/** Nominative censuses in France: every five years, 1872 for 1871, none in 1916. */
export const FRENCH_CENSUSES: readonly number[] = [
  1836, 1841, 1846, 1851, 1856, 1861, 1866, 1872, 1876, 1881, 1886, 1891, 1896, 1901, 1906, 1911,
  1921, 1926, 1931, 1936,
];

/** The civil registers begin with the decree of 20 September 1792. */
export const CIVIL_REGISTERS_FROM = 1792;
/** Deaths noted in the margin of the birth act: ordonnance of 29 March 1945. */
export const DEATH_IN_MARGIN_FROM = 1945;
/** Classes commonly kept in the registres matricules, as birth years. */
export const MILITARY_BIRTH_YEARS = { from: 1847, to: 1921 } as const;
/** Beyond this age with no death recorded, the person is presumed dead. */
const PRESUMED_DEAD_AFTER = 110;

const yearOf = (event: PlanEvent | null) => event?.year ?? null;

export function researchPlan(subject: PlanSubject, currentYear: number): PlanStep[] {
  const steps: PlanStep[] = [];
  const birthYear = yearOf(subject.birth) ?? yearOf(subject.baptism);
  const birthPlace = subject.birth?.place ?? subject.baptism?.place ?? null;
  const lastPlace = subject.places.at(-1)?.place ?? birthPlace;
  const deathYear = yearOf(subject.death) ?? yearOf(subject.burial);
  const deathPlace = subject.death?.place ?? subject.burial?.place ?? null;
  const firstMarriage = [...subject.marriages].sort(
    (a, b) => (a.year ?? Number.POSITIVE_INFINITY) - (b.year ?? Number.POSITIVE_INFINITY),
  )[0];
  const place = (value: string | null) => value ?? '';

  // --- A generation further up -------------------------------------------
  if (subject.parentsKnown < 2) {
    if (firstMarriage) {
      steps.push({
        id: 'parents-marriage',
        kind: 'PARENTS_FROM_MARRIAGE',
        priority: 'HIGH',
        params: { place: place(firstMarriage.place), year: firstMarriage.year ?? '' },
        from: firstMarriage.year,
        to: firstMarriage.year,
      });
    } else if (birthYear !== null || birthPlace) {
      steps.push({
        id: 'parents-birth',
        kind: 'PARENTS_FROM_BIRTH',
        priority: 'HIGH',
        params: { place: place(birthPlace), year: birthYear ?? '' },
        from: birthYear,
        to: birthYear,
      });
    }
  }

  // --- Birth -----------------------------------------------------------------
  const birthEvent = subject.birth ?? subject.baptism;
  if (!birthEvent || birthEvent.year === null) {
    // Estimated from a first marriage (around 25) when nothing else says.
    const estimate = firstMarriage?.year ? firstMarriage.year - 25 : null;
    if (estimate !== null) {
      const parish = estimate < CIVIL_REGISTERS_FROM;
      steps.push({
        id: 'birth-find',
        kind: parish ? 'BIRTH_PARISH' : 'BIRTH_CIVIL',
        priority: 'HIGH',
        params: {
          place: place(firstMarriage?.place ?? null),
          from: estimate - 10,
          to: estimate + 5,
        },
        from: estimate - 10,
        to: estimate + 5,
      });
    }
  } else if (!birthEvent.sourced || birthEvent.approximate) {
    const parish = birthEvent.year !== null && birthEvent.year < CIVIL_REGISTERS_FROM;
    const span = birthEvent.approximate ? 5 : 0;
    steps.push({
      id: 'birth-source',
      kind: parish ? 'BIRTH_PARISH' : birthEvent.sourced ? 'BIRTH_CIVIL' : 'BIRTH_SOURCE',
      priority: 'NORMAL',
      params: {
        place: place(birthEvent.place),
        from: birthEvent.year - span,
        to: birthEvent.year + span,
        year: birthEvent.year,
      },
      from: birthEvent.year - span,
      to: birthEvent.year + span,
    });
  }

  // --- Marriage ----------------------------------------------------------------
  if (subject.marriages.length === 0 && subject.childrenKnown > 0 && birthYear !== null) {
    steps.push({
      id: 'marriage-find',
      kind: 'MARRIAGE_FIND',
      priority: 'NORMAL',
      params: { place: place(birthPlace), from: birthYear + 18, to: birthYear + 35 },
      from: birthYear + 18,
      to: birthYear + 35,
    });
  }
  for (const [index, marriage] of subject.marriages.entries()) {
    if (marriage.sourced || marriage.year === null) continue;
    steps.push({
      id: `marriage-source-${index}`,
      kind: 'MARRIAGE_SOURCE',
      priority: 'NORMAL',
      params: { place: place(marriage.place), year: marriage.year, spouse: marriage.spouse ?? '' },
      from: marriage.year,
      to: marriage.year,
    });
  }

  // --- Death ---------------------------------------------------------------
  const presumedDead =
    !subject.isLiving && (birthYear === null || currentYear - birthYear > PRESUMED_DEAD_AFTER);
  if (deathYear === null && (presumedDead || subject.death !== null || subject.burial !== null)) {
    const lastYear = subject.places.at(-1)?.year ?? (birthYear !== null ? birthYear + 50 : null);
    if (birthYear !== null && birthYear >= 1900 && birthYear < currentYear - 18) {
      // A death since 1945 is written in the margin of the birth act.
      steps.push({
        id: 'death-margin',
        kind: 'DEATH_MARGIN',
        priority: 'HIGH',
        params: { place: place(birthPlace), year: birthYear },
        from: Math.max(DEATH_IN_MARGIN_FROM, birthYear),
        to: currentYear,
      });
    } else if (lastYear !== null || lastPlace) {
      steps.push({
        id: 'death-find',
        kind: 'DEATH_FIND',
        priority: 'HIGH',
        params: { place: place(lastPlace), from: lastYear ?? '' },
        from: lastYear,
        to: birthYear !== null ? birthYear + 100 : null,
      });
    }
  } else if (deathYear !== null && !(subject.death?.sourced ?? subject.burial?.sourced ?? false)) {
    steps.push({
      id: 'death-source',
      kind: 'DEATH_SOURCE',
      priority: 'NORMAL',
      params: { place: place(deathPlace), year: deathYear },
      from: deathYear,
      to: deathYear,
    });
  }

  // --- Censuses over the life ------------------------------------------------
  if (birthYear !== null) {
    const end = deathYear ?? (subject.isLiving ? currentYear : birthYear + 80);
    const censuses = FRENCH_CENSUSES.filter((year) => year >= birthYear && year <= end);
    const where = lastPlace ?? birthPlace;
    if (censuses.length > 0 && where) {
      steps.push({
        id: 'census',
        kind: 'CENSUS',
        priority: 'LOW',
        params: {
          place: where,
          years: censuses.join(', '),
          first: censuses[0] ?? '',
          last: censuses.at(-1) ?? '',
        },
        from: censuses[0] ?? null,
        to: censuses.at(-1) ?? null,
      });
    }
  }

  // --- Military register ------------------------------------------------------
  if (
    subject.sex === 'MALE' &&
    birthYear !== null &&
    birthYear >= MILITARY_BIRTH_YEARS.from &&
    birthYear <= MILITARY_BIRTH_YEARS.to
  ) {
    steps.push({
      id: 'military',
      kind: 'MILITARY',
      priority: 'LOW',
      params: { class: birthYear + 20, place: place(birthPlace) },
      from: birthYear + 20,
      to: birthYear + 20,
    });
  }

  // --- Succession -------------------------------------------------------------
  if (deathYear !== null && deathYear >= CIVIL_REGISTERS_FROM && deathYear <= 1970) {
    steps.push({
      id: 'succession',
      kind: 'SUCCESSION',
      priority: 'LOW',
      params: { place: place(deathPlace), year: deathYear },
      from: deathYear,
      to: deathYear + 2,
    });
  }

  // A living person's record is a matter for them: no plan beyond who
  // their parents are, and nothing that searches for their death.
  if (subject.isLiving) {
    return steps.filter((step) => step.kind.startsWith('PARENTS'));
  }
  return steps;
}
