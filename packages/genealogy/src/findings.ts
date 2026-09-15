/**
 * Findings: what validation and anomaly detection return.
 *
 * The distinction the whole module turns on:
 *
 *   ERROR   — a hard invariant. The graph must never enter this state, so the
 *             write is refused. "Someone is their own ancestor" is here.
 *   WARNING — a research signal. The data is unusual, possibly wrong, and
 *             possibly just what happened. It is surfaced and never blocks.
 *   INFO    — worth noticing, not worth worrying about.
 *
 * Conflating the two is the classic failure of genealogy software. Refusing a
 * mother aged 52 loses a real birth; accepting a death before a birth corrupts
 * every temporal query. The rule that keeps them apart is the trivalent logic:
 * a violation that is certainly true is an error, the same violation that is
 * merely possible is a warning.
 *
 * Messages are carried as a code plus parameters, never as a rendered string.
 * The product is French-first with English alongside, and a finding produced
 * in a worker must render in whatever locale the reader is using.
 */

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

export const FINDING_CODES = [
  // --- Hard invariants ----------------------------------------------------
  'SELF_RELATIONSHIP',
  'ANCESTRY_CYCLE',
  'DUPLICATE_RELATIONSHIP',
  'DEATH_BEFORE_BIRTH',
  'CHILD_BORN_BEFORE_PARENT',
  'BIRTH_AFTER_MOTHER_DEATH',
  'EVENT_OUTSIDE_LIFESPAN',
  'CUSTOM_EVENT_UNLABELLED',

  // --- Research warnings --------------------------------------------------
  'PARENT_TOO_YOUNG',
  'MOTHER_TOO_OLD',
  'FATHER_TOO_OLD',
  'LIFESPAN_IMPLAUSIBLE',
  'MARRIAGE_BEFORE_BIRTH',
  'MARRIAGE_AFTER_DEATH',
  'MARRIED_TOO_YOUNG',
  'POSTHUMOUS_BIRTH',
  'CONTRADICTORY_ACCEPTED_CLAIMS',
  'DUPLICATE_CANDIDATE',
  'SIBLINGS_BORN_TOO_CLOSE',
  'DISCONNECTED_COMPONENT',

  // --- Informational ------------------------------------------------------
  'NO_TEMPORAL_EVIDENCE',
  'CLAIM_WITHOUT_CITATION',
  'PEDIGREE_COLLAPSE',
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

export type EntityKind =
  'PERSON' | 'RELATIONSHIP' | 'EVENT' | 'CLAIM' | 'PLACE' | 'SOURCE' | 'TREE';

export interface EntityRef {
  readonly kind: EntityKind;
  readonly id: string;
  /** Cached label, so a findings list renders without extra queries. */
  readonly label?: string;
}

export interface Finding {
  readonly code: FindingCode;
  readonly severity: Severity;
  /** Entities involved. First is the subject the UI should focus. */
  readonly entities: readonly EntityRef[];
  /** Interpolation values for the translated message. */
  readonly params?: Readonly<Record<string, string | number>>;
  /**
   * How certain the violation is. A certain violation of a hard rule is an
   * ERROR; the same violation that uncertain dates merely permit is a
   * WARNING. Carrying this lets the UI say "probablement" honestly.
   */
  readonly certainty: 'CERTAIN' | 'POSSIBLE';
  /** Which screen would let a human resolve this. */
  readonly suggestedAction?:
    'REVIEW_CLAIMS' | 'REVIEW_DATES' | 'REVIEW_RELATIONSHIP' | 'MERGE_REVIEW' | 'ADD_SOURCE';
}

export function isBlocking(finding: Finding): boolean {
  return finding.severity === 'ERROR';
}

export function hasBlocking(findings: readonly Finding[]): boolean {
  return findings.some(isBlocking);
}

export function sortBySeverity(findings: readonly Finding[]): Finding[] {
  const rank: Record<Severity, number> = { ERROR: 0, WARNING: 1, INFO: 2 };
  return [...findings].sort((a, b) => {
    const bySeverity = rank[a.severity] - rank[b.severity];
    if (bySeverity !== 0) return bySeverity;
    // Certain before possible, then stable by code.
    if (a.certainty !== b.certainty) return a.certainty === 'CERTAIN' ? -1 : 1;
    return a.code.localeCompare(b.code);
  });
}

/**
 * Thresholds for the research warnings.
 *
 * Every number here is a judgement about what is unusual, not about what is
 * possible. Records exist outside all of them, which is exactly why crossing
 * one produces a warning and never a rejection. Collected in one place so they
 * can be tuned, and documented in docs/GENEALOGY_RULES.md.
 */
export interface PlausibilityThresholds {
  /** Below this age at a child's birth, flag the parent. */
  readonly minParentAgeYears: number;
  readonly maxMotherAgeYears: number;
  readonly maxFatherAgeYears: number;
  readonly maxLifespanYears: number;
  readonly minMarriageAgeYears: number;
  /**
   * Days a birth may follow the father's death and still be a normal
   * posthumous birth. Longer than a full gestation on purpose.
   */
  readonly posthumousBirthMaxDays: number;
  /**
   * Days a birth may follow the mother's death. A delivery during or just
   * after death is medically real; weeks later is not.
   */
  readonly maternalPostMortemMaxDays: number;
  /** Two births to the same mother closer than this are suspicious. */
  readonly minSiblingIntervalDays: number;
}

export const DEFAULT_THRESHOLDS: PlausibilityThresholds = {
  minParentAgeYears: 13,
  maxMotherAgeYears: 55,
  maxFatherAgeYears: 80,
  maxLifespanYears: 123,
  minMarriageAgeYears: 12,
  posthumousBirthMaxDays: 320,
  maternalPostMortemMaxDays: 2,
  minSiblingIntervalDays: 240,
};
