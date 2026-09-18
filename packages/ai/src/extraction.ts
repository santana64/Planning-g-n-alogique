import { z } from 'zod';

/**
 * What an extraction may return, and what is done to it before anyone sees it.
 *
 * The rule the whole package serves: a model's output is a proposal, never a
 * fact. Nothing here writes to the tree. What leaves this module is a list of
 * candidate statements, each carrying the exact words of the source it claims
 * to rest on — and any statement whose words cannot be found in that source is
 * dropped before a reviewer is asked to trust it.
 */

/**
 * The statements an extraction may propose.
 *
 * A subset of the database's ClaimPredicate, named identically so a proposal
 * maps onto a claim without a translation table that could drift. Anything a
 * register says that does not fit here is left for the human to transcribe —
 * a narrower vocabulary that is always right beats a wider one that invents.
 */
export const FACT_PREDICATES = [
  'NAME',
  'RECORDED_SEX',
  'BIRTH_DATE',
  'BIRTH_PLACE',
  'BAPTISM_DATE',
  'DEATH_DATE',
  'DEATH_PLACE',
  'BURIAL_DATE',
  'MARRIAGE_DATE',
  'MARRIAGE_PLACE',
  'OCCUPATION',
  'RESIDENCE',
  'PARENT',
  'SPOUSE',
  'CHILD',
] as const;
export type FactPredicate = (typeof FACT_PREDICATES)[number];

export const DOCUMENT_KINDS = [
  'BIRTH_ACT',
  'BAPTISM_ACT',
  'MARRIAGE_ACT',
  'DEATH_ACT',
  'BURIAL_ACT',
  'CENSUS',
  'OTHER',
] as const;

/**
 * The shape a provider returns.
 *
 * Deliberately free of numeric bounds and formats: structured-output schemas
 * support a restricted subset of JSON Schema, and a `minimum` the backend
 * ignores is a constraint that only looks enforced. Ranges are checked here,
 * in code, where they actually are.
 */
export const extractionOutputSchema = z.object({
  documentKind: z.enum(DOCUMENT_KINDS),
  facts: z.array(
    z.object({
      predicate: z.enum(FACT_PREDICATES),
      /** Who the statement is about, spelled as the text spells it. */
      subjectName: z.string(),
      /** The value as the text gives it — a date in words stays in words. */
      valueText: z.string(),
      /**
       * A normalised form when one is certain: a date as "12 JUN 1822", a sex
       * as MALE or FEMALE. Null rather than a guess.
       */
      normalised: z.string().nullable(),
      /** The exact passage the statement rests on, copied from the input. */
      evidence: z.string(),
      /** The provider's own confidence, 0 to 1. Shown, never used to accept. */
      confidence: z.number(),
    }),
  ),
  /** What could not be read or was uncertain, in plain words. */
  caveats: z.array(z.string()),
});
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

export interface ExtractedFact {
  readonly predicate: FactPredicate;
  readonly subjectName: string;
  readonly valueText: string;
  readonly normalised: string | null;
  readonly evidence: string;
  readonly confidence: number;
}

export interface ExtractionProvenance {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly pipelineVersion: string;
}

export interface ExtractionResult {
  readonly documentKind: (typeof DOCUMENT_KINDS)[number];
  readonly facts: readonly ExtractedFact[];
  readonly caveats: readonly string[];
  /**
   * Statements the provider returned whose evidence is not in the source.
   *
   * Counted and reported rather than silently dropped. A reviewer who sees
   * "three statements were discarded" learns something true about the tool;
   * one who never sees them is being managed.
   */
  readonly discarded: number;
  readonly provenance: ExtractionProvenance;
}

/**
 * Bumped whenever the verification rules change, so a proposal records which
 * rules it passed. Separate from the prompt version: the same prompt can be
 * filtered by different rules.
 */
export const PIPELINE_VERSION = 'verify-evidence-1';

/** Case-, accent- and whitespace-insensitive, for matching quotes to sources. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’'`]/g, "'")
    .replace(/[«»"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether a quoted passage actually occurs in the source.
 *
 * The one check that separates reading from inventing. Folding tolerates what
 * a faithful copy can still differ in — a curly apostrophe, a line break, an
 * accent — and nothing else: a paraphrase does not match, and neither does a
 * passage that was never there.
 */
export function evidenceOccursIn(evidence: string, source: string): boolean {
  const needle = fold(evidence);
  // A one-word "quote" matches almost anything and proves nothing.
  if (needle.length < 4) return false;
  return fold(source).includes(needle);
}

/**
 * Turn a provider's raw output into what a reviewer may see.
 *
 * Every rule here removes or bounds; none adds. The provider's words go
 * through untouched when they pass, and are counted when they do not.
 */
export function verifyExtraction(
  output: ExtractionOutput,
  source: string,
  provenance: ExtractionProvenance,
): ExtractionResult {
  const facts: ExtractedFact[] = [];
  let discarded = 0;

  for (const fact of output.facts) {
    const valueText = fact.valueText.trim();
    const subjectName = fact.subjectName.trim();

    if (!valueText || !subjectName || !evidenceOccursIn(fact.evidence, source)) {
      discarded += 1;
      continue;
    }

    facts.push({
      predicate: fact.predicate,
      subjectName,
      valueText,
      normalised: fact.normalised?.trim() || null,
      evidence: fact.evidence.trim(),
      // Clamped rather than trusted: a confidence of 1.4 is a bug in the
      // provider, not a stronger reading.
      confidence: Number.isFinite(fact.confidence) ? Math.min(1, Math.max(0, fact.confidence)) : 0,
    });
  }

  return {
    documentKind: output.documentKind,
    facts,
    caveats: output.caveats.map((caveat) => caveat.trim()).filter(Boolean),
    discarded,
    provenance: { ...provenance, pipelineVersion: PIPELINE_VERSION },
  };
}
