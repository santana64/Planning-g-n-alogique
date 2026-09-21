import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { Finding } from '@chronolignee/genealogy';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { findingMessage, severityLabel, type FindingTranslator } from './finding-messages';

/**
 * Which name goes where.
 *
 * This exists because the renderer had the two the wrong way round and
 * produced "Hippolyte aurait 57 ans à la naissance de Victoire" — fluent,
 * plausible, and pointing the researcher at the wrong record. The bug is
 * invisible to a typecheck: both entities are strings.
 *
 * The contract being locked down: findings from the parent/child validator
 * carry [child, parent], in that order.
 *
 * The sentences come from the real catalogues, through the real message
 * formatter. A key the code asks for and the catalogue does not have fails
 * here rather than in front of a reader.
 */

const translator = (locale: 'fr' | 'en'): FindingTranslator =>
  // Cast because the imported JSON gives `createTranslator` literal key
  // types, while this module takes a translator it can call with a code it
  // computes. The keys are checked all the same: `onError` throws, so a key
  // the catalogue does not have fails the test rather than rendering itself.
  createTranslator({
    locale,
    messages: locale === 'fr' ? fr : en,
    namespace: 'findings',
    onError: (error) => {
      throw error;
    },
  }) as unknown as FindingTranslator;

const french = translator('fr');
const english = translator('en');

const CHILD = { kind: 'PERSON' as const, id: 'c', label: 'Hippolyte MARCHAND' };
const PARENT = { kind: 'PERSON' as const, id: 'p', label: 'Victoire MARCHAND' };

function parentChild(code: Finding['code'], params?: Finding['params']): Finding {
  return {
    code,
    severity: 'WARNING',
    certainty: 'CERTAIN',
    entities: [CHILD, PARENT],
    ...(params ? { params } : {}),
  };
}

describe('parent and child are not interchangeable', () => {
  it('ages the parent, not the child', () => {
    const finding = parentChild('MOTHER_TOO_OLD', { age: 57, threshold: 55 });
    expect(findingMessage(french, finding)).toBe(
      'Victoire MARCHAND aurait 57 ans à la naissance de Hippolyte MARCHAND (seuil : 55).',
    );
    expect(findingMessage(english, finding)).toBe(
      'Victoire MARCHAND would be 57 at the birth of Hippolyte MARCHAND (threshold: 55).',
    );
  });

  it('says the child is the one born too early', () => {
    const finding = parentChild('CHILD_BORN_BEFORE_PARENT', { days: 400 });
    expect(findingMessage(french, finding)).toBe(
      'Hippolyte MARCHAND naît 400 jours avant Victoire MARCHAND, son parent.',
    );
    expect(findingMessage(english, finding)).toBe(
      'Hippolyte MARCHAND is born 400 days before Victoire MARCHAND, their parent.',
    );
  });

  it('attributes the death to the mother and the birth to the child', () => {
    expect(findingMessage(french, parentChild('BIRTH_AFTER_MOTHER_DEATH', { days: 30 }))).toBe(
      'Hippolyte MARCHAND naît 30 jours après le décès de sa mère Victoire MARCHAND.',
    );
  });

  it('keeps the same order for a posthumous birth', () => {
    expect(findingMessage(french, parentChild('POSTHUMOUS_BIRTH', { days: 120 }))).toBe(
      'Hippolyte MARCHAND naît 120 jours après le décès de son père Victoire MARCHAND.',
    );
  });
});

describe('uncertainty survives into the sentence', () => {
  const implausible: Finding = {
    code: 'LIFESPAN_IMPLAUSIBLE',
    severity: 'WARNING',
    certainty: 'POSSIBLE',
    entities: [CHILD],
    params: { years: 130, threshold: 123 },
  };

  it('says "probablement" when the dates only permit the violation', () => {
    // Dropping this word would turn "the dates are loose enough that this
    // might be wrong" into "this is wrong", which the evidence does not say.
    expect(findingMessage(french, implausible)).toBe(
      'Probablement : Hippolyte MARCHAND vivrait 130 ans (seuil : 123).',
    );
    expect(findingMessage(english, implausible)).toBe(
      'Probably: Hippolyte MARCHAND would have lived 130 years (threshold: 123).',
    );
  });

  it('states a certain violation flatly', () => {
    expect(
      findingMessage(french, {
        code: 'DEATH_BEFORE_BIRTH',
        severity: 'ERROR',
        certainty: 'CERTAIN',
        entities: [CHILD],
      }),
    ).toBe('Hippolyte MARCHAND : le décès précède la naissance.');
  });
});

describe('a finding with no names still reads', () => {
  it('falls back rather than rendering "undefined"', () => {
    const nameless: Finding = {
      code: 'NO_TEMPORAL_EVIDENCE',
      severity: 'INFO',
      certainty: 'CERTAIN',
      entities: [{ kind: 'PERSON', id: 'x' }],
    };
    expect(findingMessage(french, nameless)).toContain('cette personne');
    expect(findingMessage(english, nameless)).toContain('this person');
  });
});

describe('every code the validator can emit has a sentence', () => {
  // The list the audit and the validator share. A code added to the engine
  // and forgotten here would reach a reader as a raw identifier.
  const CODES: Finding['code'][] = [
    'SELF_RELATIONSHIP',
    'ANCESTRY_CYCLE',
    'DUPLICATE_RELATIONSHIP',
    'DEATH_BEFORE_BIRTH',
    'CHILD_BORN_BEFORE_PARENT',
    'BIRTH_AFTER_MOTHER_DEATH',
    'EVENT_OUTSIDE_LIFESPAN',
    'CUSTOM_EVENT_UNLABELLED',
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
    'NO_TEMPORAL_EVIDENCE',
    'CLAIM_WITHOUT_CITATION',
    'PEDIGREE_COLLAPSE',
  ];

  it('renders in both languages, with no placeholder left behind', () => {
    for (const code of CODES) {
      for (const t of [french, english]) {
        const message = findingMessage(t, parentChild(code, { days: 1, age: 1, threshold: 1 }));
        expect(message.length, code).toBeGreaterThan(5);
        expect(message, code).not.toContain('{');
        expect(message, code).not.toContain('undefined');
      }
    }
  });

  it('labels every severity', () => {
    for (const severity of ['ERROR', 'WARNING', 'INFO'] as const) {
      expect(severityLabel(french, severity).length).toBeGreaterThan(2);
      expect(severityLabel(english, severity).length).toBeGreaterThan(2);
    }
  });
});
