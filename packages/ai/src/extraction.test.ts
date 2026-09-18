import { describe, expect, it } from 'vitest';
import { evidenceOccursIn, verifyExtraction, type ExtractionOutput } from './extraction';

/**
 * The evidence check.
 *
 * The one rule between a model reading a register and a model inventing one:
 * every statement must quote words that are actually in the source. These
 * tests pin down what counts as the same words and what does not.
 */

const SOURCE =
  "L'an mil huit cent vingt-deux, le douze juin, est comparu Pierre Chassagne, tonnelier, lequel nous a présenté un enfant du sexe masculin, né le 12 juin 1822 à Tours, fils de Pierre Chassagne et de Marie Lefèvre.";

const PROVENANCE = {
  provider: 'test',
  model: 'test-1',
  promptVersion: 'p',
  pipelineVersion: 'x',
};

function output(facts: ExtractionOutput['facts']): ExtractionOutput {
  return { documentKind: 'BIRTH_ACT', facts, caveats: [] };
}

describe('what counts as the same words', () => {
  it('accepts an exact quotation', () => {
    expect(evidenceOccursIn('né le 12 juin 1822 à Tours', SOURCE)).toBe(true);
  });

  it('tolerates what a faithful copy can still differ in', () => {
    // Accents dropped, a curly apostrophe, a line break, different case.
    expect(evidenceOccursIn('ne le 12 JUIN 1822\na tours', SOURCE)).toBe(true);
    expect(evidenceOccursIn('L’an mil huit cent', SOURCE)).toBe(true);
  });

  it('refuses a paraphrase', () => {
    // True, and still not a quotation. A reviewer comparing it to the page
    // would not find it.
    expect(evidenceOccursIn('born on 12 June 1822 in Tours', SOURCE)).toBe(false);
    expect(evidenceOccursIn('fils de Pierre et Marie', SOURCE)).toBe(false);
  });

  it('refuses a passage that is not there at all', () => {
    expect(evidenceOccursIn('décédé le 3 mars 1889', SOURCE)).toBe(false);
  });

  it('refuses a quote too short to prove anything', () => {
    // "le" occurs in every register ever written.
    expect(evidenceOccursIn('le', SOURCE)).toBe(false);
  });
});

describe('verifying an extraction', () => {
  it('keeps a statement whose evidence is in the source', () => {
    const result = verifyExtraction(
      output([
        {
          predicate: 'BIRTH_DATE',
          subjectName: 'Pierre Chassagne',
          valueText: '12 juin 1822',
          normalised: '12 JUN 1822',
          evidence: 'né le 12 juin 1822',
          confidence: 0.9,
        },
      ]),
      SOURCE,
      PROVENANCE,
    );
    expect(result.facts).toHaveLength(1);
    expect(result.discarded).toBe(0);
  });

  it('drops a statement with invented evidence, and counts it', () => {
    const result = verifyExtraction(
      output([
        {
          predicate: 'DEATH_DATE',
          subjectName: 'Pierre Chassagne',
          valueText: '3 mars 1889',
          normalised: '3 MAR 1889',
          evidence: 'décédé le 3 mars 1889',
          confidence: 0.95,
        },
      ]),
      SOURCE,
      PROVENANCE,
    );
    // High confidence changes nothing. The source does not say it.
    expect(result.facts).toHaveLength(0);
    expect(result.discarded).toBe(1);
  });

  it('drops a statement with an empty value or subject', () => {
    const result = verifyExtraction(
      output([
        {
          predicate: 'OCCUPATION',
          subjectName: '',
          valueText: 'tonnelier',
          normalised: null,
          evidence: 'Pierre Chassagne, tonnelier',
          confidence: 0.8,
        },
      ]),
      SOURCE,
      PROVENANCE,
    );
    expect(result.facts).toHaveLength(0);
    expect(result.discarded).toBe(1);
  });

  it('clamps a confidence outside 0 to 1 rather than trusting it', () => {
    const result = verifyExtraction(
      output([
        {
          predicate: 'OCCUPATION',
          subjectName: 'Pierre Chassagne',
          valueText: 'tonnelier',
          normalised: null,
          evidence: 'Pierre Chassagne, tonnelier',
          confidence: 1.4,
        },
      ]),
      SOURCE,
      PROVENANCE,
    );
    expect(result.facts[0]?.confidence).toBe(1);
  });

  it('turns an empty normalised form into null, not a blank value', () => {
    const result = verifyExtraction(
      output([
        {
          predicate: 'BIRTH_PLACE',
          subjectName: 'Pierre Chassagne',
          valueText: 'Tours',
          normalised: '   ',
          evidence: 'à Tours',
          confidence: 0.7,
        },
      ]),
      SOURCE,
      PROVENANCE,
    );
    expect(result.facts[0]?.normalised).toBeNull();
  });

  it('records the pipeline version that did the checking', () => {
    const result = verifyExtraction(output([]), SOURCE, PROVENANCE);
    expect(result.provenance.pipelineVersion).toBe('verify-evidence-1');
    expect(result.provenance.model).toBe('test-1');
  });
});
