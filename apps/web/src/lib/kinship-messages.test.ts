import { describe, expect, it } from 'vitest';
import type { Kinship } from '@chronolignee/genealogy';
import { kinshipLabel, kinshipThrough } from './kinship-messages';

/**
 * French kinship terms.
 *
 * Worth testing because the French names are not a translation of the English
 * ones: "cousin issu de germain" is a second cousin, and the phrase that looks
 * like a literal translation of "second cousin" means something else. Getting
 * this wrong produces a sentence that reads perfectly and is false.
 */

function relation(partial: Partial<Kinship> & Pick<Kinship, 'code'>): Kinship {
  return { up: 0, down: 0, degree: 0, removal: 0, through: [], ...partial };
}

describe('the direct line', () => {
  it('names a parent', () => {
    expect(kinshipLabel(relation({ code: 'DESCENDANT', up: 1 }), 'FEMALE')).toBe('Mère');
  });

  it('names a grandparent', () => {
    expect(kinshipLabel(relation({ code: 'DESCENDANT', up: 2 }), 'MALE')).toBe('Grand-père');
  });

  it('builds arrière- for each generation past the grandparent', () => {
    expect(kinshipLabel(relation({ code: 'DESCENDANT', up: 3 }), 'MALE')).toBe(
      'Arrière-grand-père',
    );
    expect(kinshipLabel(relation({ code: 'DESCENDANT', up: 5 }), 'FEMALE')).toBe(
      'Arrière-arrière-arrière-grand-mère',
    );
  });

  it('goes down the other way', () => {
    expect(kinshipLabel(relation({ code: 'ANCESTOR', down: 2 }), 'FEMALE')).toBe('Petite-fille');
    expect(kinshipLabel(relation({ code: 'ANCESTOR', down: 4 }), 'MALE')).toBe(
      'Arrière-arrière-petit-fils',
    );
  });
});

describe('cousins', () => {
  it('agrees the qualifier with the person', () => {
    // "Germain" is an adjective. "Cousine germain" reads as fluent French and
    // is simply wrong, which is the only kind of error that survives review.
    expect(kinshipLabel(relation({ code: 'COUSIN', degree: 1 }), 'FEMALE')).toBe(
      'Cousine germaine',
    );
    expect(kinshipLabel(relation({ code: 'COUSIN', degree: 1 }), 'MALE')).toBe('Cousin germain');
  });

  it('agrees with the nearest noun when the sex is unknown', () => {
    expect(kinshipLabel(relation({ code: 'COUSIN', degree: 1 }))).toBe(
      'Cousin ou cousine germaine',
    );
  });

  it('calls a second cousin issu de germain, not "au second degré"', () => {
    // The mistranslation this guards against. "Au second degré" is a different
    // relation, and the sentence reads perfectly either way.
    expect(kinshipLabel(relation({ code: 'COUSIN', degree: 2 }), 'MALE')).toBe(
      'Cousin issu de germain',
    );
  });

  it('inflects "issu" as well', () => {
    expect(kinshipLabel(relation({ code: 'COUSIN', degree: 2 }), 'FEMALE')).toBe(
      'Cousine issue de germain',
    );
  });

  it('states the removal when the two are not on the same level', () => {
    expect(kinshipLabel(relation({ code: 'COUSIN', degree: 1, removal: 1 }), 'MALE')).toBe(
      'Cousin germain, à un degré d’écart',
    );
  });

  it('falls back to a number past the terms French actually has', () => {
    expect(kinshipLabel(relation({ code: 'COUSIN', degree: 7 }))).toContain('7e degré');
  });
});

describe('the collateral line', () => {
  it('names an aunt', () => {
    expect(kinshipLabel(relation({ code: 'PIBLING', up: 2, down: 1 }), 'FEMALE')).toBe('Tante');
  });

  it('adds grand- for a great-uncle', () => {
    expect(kinshipLabel(relation({ code: 'PIBLING', up: 3, down: 1 }), 'MALE')).toBe('Grand-oncle');
  });

  it('names a niece and a great-nephew', () => {
    expect(kinshipLabel(relation({ code: 'NIBLING', up: 1, down: 2 }), 'FEMALE')).toBe('Nièce');
    expect(kinshipLabel(relation({ code: 'NIBLING', up: 1, down: 3 }), 'MALE')).toBe('Petit-neveu');
  });
});

describe('what it refuses to guess', () => {
  it('stays neutral when the recorded sex is unknown', () => {
    // Inventing a sex to make the sentence flow is exactly the fake precision
    // the product refuses. The record said nothing; so does the label.
    expect(kinshipLabel(relation({ code: 'SIBLING', up: 1, down: 1 }))).toBe('Frère ou sœur');
    expect(kinshipLabel(relation({ code: 'PIBLING', up: 2, down: 1 }))).toBe('Oncle ou tante');
    expect(kinshipLabel(relation({ code: 'DESCENDANT', up: 1 }))).toBe('Parent');
  });

  it('says plainly when there is no link', () => {
    expect(kinshipLabel(relation({ code: 'UNRELATED' }))).toBe('Aucun lien trouvé dans cet arbre');
  });

  it('calls a spouse a spouse', () => {
    expect(kinshipLabel(relation({ code: 'PARTNER' }), 'UNKNOWN')).toBe('Conjoint');
  });
});

describe('naming the shared ancestors', () => {
  it('lists one', () => {
    expect(kinshipThrough(['Mathurin CHASSAGNE'])).toBe('par Mathurin CHASSAGNE');
  });

  it('joins a couple with "et"', () => {
    expect(kinshipThrough(['Mathurin CHASSAGNE', 'Perrine GAUTIER'])).toBe(
      'par Mathurin CHASSAGNE et Perrine GAUTIER',
    );
  });

  it('says nothing rather than "par" followed by a blank', () => {
    expect(kinshipThrough(['', ''])).toBe('');
  });
});
