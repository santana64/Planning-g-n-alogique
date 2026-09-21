import type { JdnInterval } from '@chronolignee/domain';

/**
 * Two records, one person?
 *
 * A deterministic score, never a decision. Two imports of the same family,
 * a cousin's file merged into yours, an act transcribed twice — the same
 * person ends up on two rows, and the tree quietly counts them as two.
 * Finding those pairs is arithmetic; deciding they are the same person is
 * research, and stays with the researcher: nothing here merges anything
 * ([GENEALOGY_RULES.md](../../../docs/GENEALOGY_RULES.md)).
 *
 * Every signal is reported with its own value, so the interface can say
 * *why* a pair is suspicious. A number alone would ask the reader to trust
 * it, which is exactly what a genealogy tool must not ask.
 */

export const DUPLICATE_SCORER_VERSION = 'signals-1';

export type DuplicateSignalName =
  'surname' | 'given' | 'birth' | 'death' | 'parents' | 'partners' | 'children' | 'birthPlace';

export interface DuplicateSubject {
  readonly id: string;
  /** Accent-folded, lowercase. Empty when the record has no surname. */
  readonly surname: string;
  readonly given: string;
  readonly recordedSex: 'MALE' | 'FEMALE' | 'INTERSEX' | 'UNKNOWN';
  readonly birth: JdnInterval | null;
  readonly death: JdnInterval | null;
  /** Accent-folded, lowercase name of the birth place, when recorded. */
  readonly birthPlace: string | null;
  readonly parentIds: readonly string[];
  readonly partnerIds: readonly string[];
  readonly childIds: readonly string[];
}

export interface DuplicateSignal {
  readonly name: DuplicateSignalName;
  /** 0 to 1. */
  readonly value: number;
  /** How much this signal counted, before normalisation. */
  readonly weight: number;
}

export interface DuplicateScore {
  /** 0 to 1, comparable only within one scorer version. */
  readonly score: number;
  readonly signals: readonly DuplicateSignal[];
  /** Why the pair was refused outright, when it was. */
  readonly refusedBecause?:
    'SAME_PERSON' | 'RECORDED_SEX_DIFFERS' | 'DIRECTLY_RELATED' | 'DATES_EXCLUDE_IT';
}

/**
 * What each signal is worth when it can be measured.
 *
 * Judgements, not facts: they are collected here, injectable, and the numbers
 * the interface shows always come with the signals that produced them.
 * A name carries most of the weight because it is what is always recorded;
 * dates decide between two people who share one.
 */
export interface DuplicateWeights {
  readonly surname: number;
  readonly given: number;
  readonly birth: number;
  readonly death: number;
  readonly parents: number;
  readonly partners: number;
  readonly children: number;
  readonly birthPlace: number;
}

export const DEFAULT_DUPLICATE_WEIGHTS: DuplicateWeights = {
  surname: 0.24,
  given: 0.2,
  birth: 0.24,
  death: 0.08,
  parents: 0.12,
  partners: 0.05,
  children: 0.05,
  birthPlace: 0.02,
};

/**
 * Above this, a pair is worth a human's attention.
 *
 * A product decision: lower it and the review fills with homonyms, raise it
 * and two records of the same person with one date apart never meet.
 */
export const DEFAULT_DUPLICATE_THRESHOLD = 0.62;

/** Years of distance beyond which two births are not the same event. */
const BIRTH_TOLERANCE_YEARS = 8;
const DAYS_PER_YEAR = 365.2425;

/** Dice coefficient on character bigrams: no dependency, and stable. */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (value: string): string[] => {
    const padded = ` ${value} `;
    return Array.from({ length: padded.length - 1 }, (_, index) => padded.slice(index, index + 2));
  };
  const left = bigrams(a);
  const right = new Map<string, number>();
  for (const pair of bigrams(b)) right.set(pair, (right.get(pair) ?? 0) + 1);

  let shared = 0;
  for (const pair of left) {
    const count = right.get(pair) ?? 0;
    if (count > 0) {
      shared += 1;
      right.set(pair, count - 1);
    }
  }
  return (2 * shared) / (left.length + bigrams(b).length);
}

/**
 * How close two date windows are, as a value between 0 and 1.
 *
 * Overlapping windows are a 1: "1877" and "about 1877" describe the same
 * year. Beyond that the value falls with the distance between them, and two
 * births eight years apart share nothing.
 */
function windowCloseness(a: JdnInterval | null, b: JdnInterval | null): number | null {
  if (!a || !b) return null;
  const aStart = a.earliest ?? a.latest;
  const aEnd = a.latest ?? a.earliest;
  const bStart = b.earliest ?? b.latest;
  const bEnd = b.latest ?? b.earliest;
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return null;

  const gapDays = Math.max(0, Math.max(aStart, bStart) - Math.min(aEnd, bEnd));
  if (gapDays === 0) return 1;
  const gapYears = gapDays / DAYS_PER_YEAR;
  return Math.max(0, 1 - gapYears / BIRTH_TOLERANCE_YEARS);
}

/** Jaccard index of two id sets, or null when either side records none. */
function sharedIds(a: readonly string[], b: readonly string[]): number | null {
  if (a.length === 0 || b.length === 0) return null;
  const right = new Set(b);
  const shared = new Set(a.filter((id) => right.has(id))).size;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? null : shared / union;
}

function directlyRelated(a: DuplicateSubject, b: DuplicateSubject): boolean {
  return (
    a.parentIds.includes(b.id) ||
    b.parentIds.includes(a.id) ||
    a.childIds.includes(b.id) ||
    b.childIds.includes(a.id) ||
    a.partnerIds.includes(b.id) ||
    b.partnerIds.includes(a.id)
  );
}

/**
 * Score one pair.
 *
 * Three refusals come before any arithmetic, because no accumulation of
 * similar names should overcome them:
 *
 *  - the same row twice;
 *  - two records the register sexes differently — it wrote what it wrote;
 *  - two people already linked to each other. A father and his son with the
 *    same name, born thirty years apart, are the classic false positive, and
 *    proposing their merge is how a tree loses a generation;
 *  - two records whose dated births (or deaths) fall further apart than the
 *    tolerance. That is not a missing signal, it is evidence against: however
 *    alike the names read, merging them would destroy a date.
 */
export function scoreDuplicate(
  a: DuplicateSubject,
  b: DuplicateSubject,
  weights: DuplicateWeights = DEFAULT_DUPLICATE_WEIGHTS,
): DuplicateScore {
  if (a.id === b.id) return { score: 0, signals: [], refusedBecause: 'SAME_PERSON' };
  if (
    (a.recordedSex === 'MALE' && b.recordedSex === 'FEMALE') ||
    (a.recordedSex === 'FEMALE' && b.recordedSex === 'MALE')
  ) {
    return { score: 0, signals: [], refusedBecause: 'RECORDED_SEX_DIFFERS' };
  }
  if (directlyRelated(a, b)) {
    return { score: 0, signals: [], refusedBecause: 'DIRECTLY_RELATED' };
  }

  const birthCloseness = windowCloseness(a.birth, b.birth);
  const deathCloseness = windowCloseness(a.death, b.death);
  if (birthCloseness === 0 || deathCloseness === 0) {
    return { score: 0, signals: [], refusedBecause: 'DATES_EXCLUDE_IT' };
  }

  const measured: Array<{ name: DuplicateSignalName; value: number; weight: number }> = [];
  const add = (name: DuplicateSignalName, value: number | null): void => {
    if (value === null) return;
    measured.push({ name, value, weight: weights[name] });
  };

  add('surname', a.surname && b.surname ? nameSimilarity(a.surname, b.surname) : null);
  add('given', a.given && b.given ? nameSimilarity(a.given, b.given) : null);
  add('birth', birthCloseness);
  add('death', deathCloseness);
  add('parents', sharedIds(a.parentIds, b.parentIds));
  add('partners', sharedIds(a.partnerIds, b.partnerIds));
  add('children', sharedIds(a.childIds, b.childIds));
  add('birthPlace', a.birthPlace && b.birthPlace ? (a.birthPlace === b.birthPlace ? 1 : 0) : null);

  // Normalised over the signals that could be measured: a pair with no
  // recorded dates is not penalised for the dates it does not have — it is
  // judged on what both records actually say.
  const total = measured.reduce((sum, signal) => sum + signal.weight, 0);
  const score = total === 0 ? 0 : measured.reduce((sum, s) => sum + s.value * s.weight, 0) / total;

  return { score, signals: measured };
}

export interface DuplicatePair {
  readonly leftId: string;
  readonly rightId: string;
  readonly score: number;
  readonly signals: readonly DuplicateSignal[];
}

export interface RankOptions {
  readonly threshold?: number;
  readonly weights?: DuplicateWeights;
  /** Most pairs to return, highest score first. */
  readonly limit?: number;
}

/**
 * Score a list of candidate pairs and keep those worth reviewing.
 *
 * The pairs come from the caller — in the application, from a trigram query
 * that only brings together records whose names already resemble each other.
 * Comparing every person with every other is quadratic and pointless: two
 * records of one person nearly always agree on a name.
 */
export function rankDuplicatePairs(
  subjects: ReadonlyMap<string, DuplicateSubject>,
  pairs: ReadonlyArray<readonly [string, string]>,
  options: RankOptions = {},
): DuplicatePair[] {
  const threshold = options.threshold ?? DEFAULT_DUPLICATE_THRESHOLD;
  const found: DuplicatePair[] = [];
  const seen = new Set<string>();

  for (const [first, second] of pairs) {
    // One row per unordered pair, always the same way round, because the
    // database stores it that way.
    const [leftId, rightId] = first < second ? [first, second] : [second, first];
    const key = `${leftId}|${rightId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const left = subjects.get(leftId);
    const right = subjects.get(rightId);
    if (!left || !right) continue;

    const scored = scoreDuplicate(left, right, options.weights);
    if (scored.refusedBecause || scored.score < threshold) continue;
    found.push({ leftId, rightId, score: scored.score, signals: scored.signals });
  }

  found.sort((a, b) => b.score - a.score || a.leftId.localeCompare(b.leftId));
  return options.limit === undefined ? found : found.slice(0, options.limit);
}
