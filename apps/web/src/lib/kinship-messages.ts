import type { Kinship } from '@chronolignee/genealogy';

/**
 * Kinship, in French.
 *
 * French names these relations by their own rules, and the rules are not a
 * translation of the English ones. "Cousin issu de germain" is a second
 * cousin; "cousin germain au second degré" is something else entirely and is
 * a common mistranslation. Degrees are spelled out to the fourth because that
 * is where genealogical usage stops being ordinal and starts being numeric.
 *
 * Sex is not guessed. Where French would normally gender the word — cousin /
 * cousine, oncle / tante — the recorded sex may be unknown, and inventing one
 * to make a sentence read smoothly is exactly the fake precision this product
 * refuses. The neutral form is used unless the record says otherwise.
 */

export type KinshipSex = 'MALE' | 'FEMALE' | 'INTERSEX' | 'UNKNOWN';

/** "arrière-arrière-…" past the third generation, as French actually builds it. */
function ascendantTerm(generations: number, sex: KinshipSex): string {
  const gendered = (neutral: string, male: string, female: string): string =>
    sex === 'MALE' ? male : sex === 'FEMALE' ? female : neutral;

  if (generations === 1) return gendered('parent', 'père', 'mère');
  if (generations === 2) return gendered('grand-parent', 'grand-père', 'grand-mère');

  const prefix = 'arrière-'.repeat(generations - 2);
  return `${prefix}${gendered('grand-parent', 'grand-père', 'grand-mère')}`;
}

function descendantTerm(generations: number, sex: KinshipSex): string {
  const gendered = (neutral: string, male: string, female: string): string =>
    sex === 'MALE' ? male : sex === 'FEMALE' ? female : neutral;

  if (generations === 1) return gendered('enfant', 'fils', 'fille');
  if (generations === 2) return gendered('petit-enfant', 'petit-fils', 'petite-fille');

  const prefix = 'arrière-'.repeat(generations - 2);
  return `${prefix}${gendered('petit-enfant', 'petit-fils', 'petite-fille')}`;
}

/**
 * The qualifier, agreeing with the noun it follows.
 *
 * "Germain" and "issu" are adjectives and inflect: a woman is a cousine
 * germaine, not a cousine germain. With the sex unknown the phrase is
 * coordinated ("cousin ou cousine"), and French lets the adjective agree with
 * the nearest noun — which is the feminine one — rather than forcing a guess
 * about the person.
 *
 * From the third degree onward the qualifier stops being an adjective and
 * becomes a number, so it no longer inflects.
 */
function cousinDegree(degree: number, sex: KinshipSex): string {
  const feminine = sex !== 'MALE';
  if (degree === 1) return feminine ? 'germaine' : 'germain';
  if (degree === 2) return feminine ? 'issue de germain' : 'issu de germain';
  if (degree === 3) return 'au troisième degré';
  if (degree === 4) return 'au quatrième degré';
  return `au ${degree}e degré`;
}

function removalSuffix(removal: number): string {
  if (removal === 0) return '';
  if (removal === 1) return ', à un degré d’écart';
  return `, à ${removal} degrés d’écart`;
}

/**
 * The relation, from the subject's point of view.
 *
 * "X est votre grand-père" rather than "vous et X partagent un ancêtre" —
 * the second is what the graph computed and the first is what was asked.
 */
export function kinshipLabel(
  relation: Kinship,
  otherSex: KinshipSex = 'UNKNOWN',
  locale = 'fr',
): string {
  if (locale === 'en') return kinshipLabelEn(relation, otherSex);
  switch (relation.code) {
    case 'SELF':
      return 'La même personne';
    case 'PARTNER':
      return otherSex === 'MALE'
        ? 'Époux ou compagnon'
        : otherSex === 'FEMALE'
          ? 'Épouse ou compagne'
          : 'Conjoint';
    case 'DESCENDANT':
      // The other person is above the subject: they are the subject's ancestor.
      return capitalise(ascendantTerm(relation.up, otherSex));
    case 'ANCESTOR':
      return capitalise(descendantTerm(relation.down, otherSex));
    case 'SIBLING':
      return otherSex === 'MALE' ? 'Frère' : otherSex === 'FEMALE' ? 'Sœur' : 'Frère ou sœur';
    case 'PIBLING':
      // Uncle, great-uncle, and so on: one step off the direct line.
      return capitalise(bothOrOne(otherSex, (sex) => piblingTerm(relation.up, sex)));
    case 'NIBLING':
      return capitalise(bothOrOne(otherSex, (sex) => niblingTerm(relation.down, sex)));
    case 'COUSIN': {
      const base =
        otherSex === 'FEMALE' ? 'Cousine' : otherSex === 'MALE' ? 'Cousin' : 'Cousin ou cousine';
      return `${base} ${cousinDegree(relation.degree, otherSex)}${removalSuffix(relation.removal)}`;
    }
    case 'UNRELATED':
      return 'Aucun lien trouvé dans cet arbre';
  }
}

/**
 * French adds one "grand-" and then "arrière-" for each further generation:
 * grand-oncle, arrière-grand-oncle — never "grand-grand-oncle".
 */
function piblingTerm(up: number, sex: 'MALE' | 'FEMALE'): string {
  const base = sex === 'MALE' ? 'oncle' : 'tante';
  return up <= 2 ? base : `${'arrière-'.repeat(up - 3)}grand-${base}`;
}

/** Petit-neveu but petite-nièce: the prefix agrees, and then "arrière-" repeats. */
function niblingTerm(down: number, sex: 'MALE' | 'FEMALE'): string {
  if (down <= 2) return sex === 'MALE' ? 'neveu' : 'nièce';
  return `${'arrière-'.repeat(down - 3)}${sex === 'MALE' ? 'petit-neveu' : 'petite-nièce'}`;
}

/** The one term when the sex is recorded, both in full when it is not. */
function bothOrOne(sex: KinshipSex, term: (sex: 'MALE' | 'FEMALE') => string): string {
  if (sex === 'MALE' || sex === 'FEMALE') return term(sex);
  return `${term('MALE')} ou ${term('FEMALE')}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toLocaleUpperCase('fr-FR') + value.slice(1);
}

/** The sentence naming the shared ancestors, or empty when there are none. */
export function kinshipThrough(names: readonly string[], locale = 'fr'): string {
  const real = names.filter(Boolean);
  if (real.length === 0) return '';
  if (locale === 'en') {
    if (real.length === 1) return `through ${real[0]}`;
    return `through ${real.slice(0, -1).join(', ')} and ${real[real.length - 1]}`;
  }
  if (real.length === 1) return `par ${real[0]}`;
  return `par ${real.slice(0, -1).join(', ')} et ${real[real.length - 1]}`;
}

// --- English ----------------------------------------------------------------

/**
 * Kinship, in English: "great-" once per generation past the grandparent,
 * cousins by ordinal degree and "removed" for the generations between —
 * second cousin once removed. Sex is not guessed here either: the neutral
 * word, or both, when the record does not say.
 */
function kinshipLabelEn(relation: Kinship, sex: KinshipSex): string {
  const gendered = (neutral: string, male: string, female: string): string =>
    sex === 'MALE' ? male : sex === 'FEMALE' ? female : neutral;
  const greats = (count: number) => 'great-'.repeat(Math.max(count, 0));

  switch (relation.code) {
    case 'SELF':
      return 'The same person';
    case 'PARTNER':
      return gendered('Spouse or partner', 'Husband or partner', 'Wife or partner');
    case 'DESCENDANT': {
      const up = relation.up;
      if (up === 1) return gendered('Parent', 'Father', 'Mother');
      return capitaliseEn(
        `${greats(up - 2)}${gendered('grandparent', 'grandfather', 'grandmother')}`,
      );
    }
    case 'ANCESTOR': {
      const down = relation.down;
      if (down === 1) return gendered('Child', 'Son', 'Daughter');
      return capitaliseEn(
        `${greats(down - 2)}${gendered('grandchild', 'grandson', 'granddaughter')}`,
      );
    }
    case 'SIBLING':
      return gendered('Brother or sister', 'Brother', 'Sister');
    case 'PIBLING':
      return capitaliseEn(
        `${greats(relation.up - 2)}${gendered('uncle or aunt', 'uncle', 'aunt')}`,
      );
    case 'NIBLING':
      return capitaliseEn(
        `${greats(relation.down - 2)}${gendered('nephew or niece', 'nephew', 'niece')}`,
      );
    case 'COUSIN':
      return capitaliseEn(`${ordinalWord(relation.degree)} cousin${removedEn(relation.removal)}`);
    case 'UNRELATED':
      return 'No relationship found in this tree';
  }
}

function ordinalWord(degree: number): string {
  const words = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  if (words[degree]) return words[degree];
  const tens = degree % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][degree % 10] ?? 'th');
  return `${degree}${suffix}`;
}

function removedEn(removal: number): string {
  if (removal === 0) return '';
  if (removal === 1) return ' once removed';
  if (removal === 2) return ' twice removed';
  return ` ${removal} times removed`;
}

function capitaliseEn(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
