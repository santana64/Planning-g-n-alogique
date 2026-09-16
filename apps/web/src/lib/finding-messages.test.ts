import { describe, expect, it } from 'vitest';
import type { Finding } from '@chronolignee/genealogy';
import { findingMessage } from './finding-messages';

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
 */

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
    const message = findingMessage(parentChild('MOTHER_TOO_OLD', { age: 57, threshold: 55 }));
    expect(message).toBe(
      'Victoire MARCHAND aurait 57 ans à la naissance de Hippolyte MARCHAND (seuil : 55).',
    );
  });

  it('says the child is the one born too early', () => {
    const message = findingMessage(parentChild('CHILD_BORN_BEFORE_PARENT', { days: 400 }));
    expect(message).toBe('Hippolyte MARCHAND naît 400 jours avant Victoire MARCHAND, son parent.');
  });

  it('attributes the death to the mother and the birth to the child', () => {
    const message = findingMessage(parentChild('BIRTH_AFTER_MOTHER_DEATH', { days: 30 }));
    expect(message).toBe(
      'Hippolyte MARCHAND naît 30 jours après le décès de sa mère Victoire MARCHAND.',
    );
  });

  it('keeps the same order for a posthumous birth', () => {
    const message = findingMessage(parentChild('POSTHUMOUS_BIRTH', { days: 120 }));
    expect(message).toBe(
      'Hippolyte MARCHAND naît 120 jours après le décès de son père Victoire MARCHAND.',
    );
  });
});

describe('uncertainty survives into the sentence', () => {
  it('says "probablement" when the dates only permit the violation', () => {
    const message = findingMessage({
      code: 'LIFESPAN_IMPLAUSIBLE',
      severity: 'WARNING',
      certainty: 'POSSIBLE',
      entities: [CHILD],
      params: { years: 130, threshold: 123 },
    });
    // Dropping this word would turn "the dates are loose enough that this
    // might be wrong" into "this is wrong", which the evidence does not say.
    expect(message).toBe('Probablement : Hippolyte MARCHAND vivrait 130 ans (seuil : 123).');
  });

  it('states a certain violation flatly', () => {
    const message = findingMessage({
      code: 'DEATH_BEFORE_BIRTH',
      severity: 'ERROR',
      certainty: 'CERTAIN',
      entities: [CHILD],
    });
    expect(message).toBe('Hippolyte MARCHAND : le décès précède la naissance.');
  });
});

describe('a finding with no names still reads', () => {
  it('falls back rather than rendering "undefined"', () => {
    const message = findingMessage({
      code: 'NO_TEMPORAL_EVIDENCE',
      severity: 'INFO',
      certainty: 'CERTAIN',
      entities: [{ kind: 'PERSON', id: 'x' }],
    });
    expect(message).toContain('cette personne');
  });
});
